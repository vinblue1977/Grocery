import aws_cdk as cdk
import pytest
from aws_cdk.assertions import Match, Template

from infra.stack import FREE_TIER_CAPACITY, GroceryStack


def _template(**context: str) -> Template:
    app = cdk.App(context=context)
    stack = GroceryStack(app, "Test", env=cdk.Environment(account="123456789012", region="us-east-2"))
    return Template.from_stack(stack)


def test_table_is_provisioned_within_the_free_tier():
    props = _template().find_resources("AWS::DynamoDB::Table")
    (table,) = props.values()
    assert table["Properties"].get("BillingMode", "PROVISIONED") == "PROVISIONED"  # CloudFormation omits its default
    throughput = table["Properties"]["ProvisionedThroughput"]
    assert throughput == {"ReadCapacityUnits": FREE_TIER_CAPACITY, "WriteCapacityUnits": FREE_TIER_CAPACITY}
    assert FREE_TIER_CAPACITY <= 25
    assert table["DeletionPolicy"] == "Retain"


def test_api_is_a_function_url_not_api_gateway():
    t = _template()
    t.resource_count_is("AWS::ApiGatewayV2::Api", 0)
    t.resource_count_is("AWS::ApiGateway::RestApi", 0)
    t.has_resource_properties(
        "AWS::Lambda::Url", {"AuthType": "NONE", "Cors": {"AllowOrigins": ["https://vinblue1977.github.io"]}}
    )
    t.has_resource_properties("AWS::Lambda::Function", {"Architectures": ["arm64"], "Runtime": "python3.14"})


def test_logs_expire():
    _template().has_resource_properties("AWS::Logs::LogGroup", {"RetentionInDays": 7})


@pytest.mark.parametrize("email", ["", "me@example.com"])
def test_budget_only_with_an_alert_email(email: str):
    t = _template(alertEmail=email) if email else _template()
    t.resource_count_is("AWS::Budgets::Budget", 1 if email else 0)
    if email:
        t.has_resource_properties(
            "AWS::Budgets::Budget", {"Budget": Match.object_like({"BudgetLimit": {"Amount": 1, "Unit": "USD"}})}
        )


def test_deploy_role_only_for_the_production_environment():
    t = _template(githubRepo="someone/Grocery")
    t.has_resource_properties(
        "AWS::IAM::Role",
        {
            "AssumeRolePolicyDocument": Match.object_like(
                {
                    "Statement": [
                        Match.object_like(
                            {
                                "Condition": {
                                    "StringEquals": {
                                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                                        "token.actions.githubusercontent.com:sub": "repo:someone/Grocery:environment:production",
                                    }
                                }
                            }
                        )
                    ]
                }
            )
        },
    )


def test_bad_repo_is_rejected():
    with pytest.raises(ValueError, match="githubRepo"):
        _template(githubRepo="not a repo")
