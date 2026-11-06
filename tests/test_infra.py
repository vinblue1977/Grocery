import json

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


def test_invite_codes_expire_through_dynamodb_ttl():
    _template().has_resource_properties(
        "AWS::DynamoDB::Table", {"TimeToLiveSpecification": {"AttributeName": "ttl", "Enabled": True}}
    )


def test_logs_expire():
    _template().has_resource_properties("AWS::Logs::LogGroup", {"RetentionInDays": 7})


def test_no_budget_in_this_stack():
    _template().resource_count_is("AWS::Budgets::Budget", 0)  # the account already has one


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


def test_the_api_may_call_one_claude_model_and_nothing_else_on_bedrock():
    t = _template()
    policies = t.find_resources("AWS::IAM::Policy")
    statements = [st for p in policies.values() for st in p["Properties"]["PolicyDocument"]["Statement"]]
    bedrock = [
        st for st in statements if "bedrock:InvokeModel" in (st["Action"] if isinstance(st["Action"], list) else [st["Action"]])
    ]
    assert len(bedrock) == 1
    assert bedrock[0]["Action"] == "bedrock:InvokeModel"
    resources = bedrock[0]["Resource"]
    assert len(resources) == 2
    assert all("claude-haiku-4-5-20251001-v1:0" in str(r) for r in resources)
    t.has_resource_properties(
        "AWS::Lambda::Function",
        {"Environment": {"Variables": Match.object_like({"BEDROCK_MODEL_ID": "us.anthropic.claude-haiku-4-5-20251001-v1:0"})}},
    )


def test_the_model_can_be_switched_with_one_context_value():
    t = _template(bedrockModel="global.anthropic.claude-haiku-5-5")
    t.has_resource_properties(
        "AWS::Lambda::Function",
        {"Environment": {"Variables": Match.object_like({"BEDROCK_MODEL_ID": "global.anthropic.claude-haiku-5-5"})}},
    )
    policies = t.find_resources("AWS::IAM::Policy")
    assert "foundation-model/anthropic.claude-haiku-5-5" in json.dumps(policies)
