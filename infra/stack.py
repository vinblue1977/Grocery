"""The Grocery stack: one DynamoDB table, one Lambda behind a function URL and the GitHub deploy role.

The AWS account's existing budget alert (from TennisTracker) covers cost, so this stack has none.
Everything here stays inside the AWS always-free tier: provisioned DynamoDB at or under 25 RCU/WCU, Lambda (1M requests a
month), a function URL instead of API Gateway, and no PITR, KMS keys, NAT, VPC or Secrets Manager.
"""

import re

from aws_cdk import CfnOutput, DefaultStackSynthesizer, Duration, RemovalPolicy, Stack
from aws_cdk import aws_dynamodb as dynamodb
from aws_cdk import aws_iam as iam
from aws_cdk import aws_lambda as lambda_
from aws_cdk import aws_logs as logs
from cdk_nag import NagPackSuppression, NagSuppressions, RegexAppliesTo
from constructs import Construct

GITHUB = "token.actions.githubusercontent.com"
PAGES_ORIGIN = "https://vinblue1977.github.io"  # GitHub Pages serves the PWA from here
FREE_TIER_CAPACITY = 5  # RCU and WCU; the always-free allowance is 25 of each


class GroceryStack(Stack):
    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # One table keyed by household (PK) and record type (SK). Provisioned, not on-demand: only provisioned capacity is free.
        self.table = dynamodb.Table(
            self,
            "Table",
            partition_key=dynamodb.Attribute(name="PK", type=dynamodb.AttributeType.STRING),
            sort_key=dynamodb.Attribute(name="SK", type=dynamodb.AttributeType.STRING),
            billing_mode=dynamodb.BillingMode.PROVISIONED,
            read_capacity=FREE_TIER_CAPACITY,
            write_capacity=FREE_TIER_CAPACITY,
            time_to_live_attribute="ttl",  # expired invite codes (free)
            deletion_protection=True,
            removal_policy=RemovalPolicy.RETAIN,
        )
        NagSuppressions.add_resource_suppressions(
            self.table,
            [
                NagPackSuppression(
                    id="AwsSolutions-DDB3",
                    reason="Point-in-time recovery is billed per GB; a grocery list is not worth any cost (the $0 requirement)",
                )
            ],
        )
        CfnOutput(self, "TableName", value=self.table.table_name)

        self.api_fn = self._api()
        github_repo: str = self.node.try_get_context("githubRepo") or ""
        if github_repo:
            self._github_deploy_role(github_repo)

    def _api(self) -> lambda_.Function:
        log_group = logs.LogGroup(self, "ApiLogs", retention=logs.RetentionDays.ONE_WEEK, removal_policy=RemovalPolicy.DESTROY)
        fn = lambda_.Function(
            self,
            "Api",
            runtime=lambda_.Runtime.PYTHON_3_14,
            architecture=lambda_.Architecture.ARM_64,
            handler="api.handler.handler",
            code=lambda_.Code.from_asset("backend", exclude=["**/__pycache__", "**/*.pyc"]),
            memory_size=128,
            timeout=Duration.seconds(10),
            environment={"TABLE_NAME": self.table.table_name},
            log_group=log_group,
        )
        self.table.grant_read_write_data(fn)
        # Auth is the app's own device token, checked in the handler; the URL itself is public. CORS: the Pages origin only.
        url = fn.add_function_url(
            auth_type=lambda_.FunctionUrlAuthType.NONE,
            cors=lambda_.FunctionUrlCorsOptions(
                allowed_origins=[self.node.try_get_context("siteOrigin") or PAGES_ORIGIN],
                allowed_methods=[lambda_.HttpMethod.ALL],
                allowed_headers=["authorization", "content-type"],
                max_age=Duration.hours(1),
            ),
        )
        NagSuppressions.add_resource_suppressions(
            fn,
            [
                NagPackSuppression(
                    id="AwsSolutions-IAM4",
                    reason="The AWS-managed basic execution policy only writes this function's own logs",
                    applies_to=[
                        RegexAppliesTo(regex=r"/^Policy::arn:.+:iam::aws:policy\/service-role\/AWSLambdaBasicExecutionRole$/")
                    ],
                ),
                NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="Table-scoped data access; index wildcard is the table's own indexes",
                    applies_to=[RegexAppliesTo(regex=r"/^Resource::<.+\.Arn>\/index\/\*$/")],
                ),
            ],
            apply_to_children=True,
        )
        CfnOutput(self, "ApiUrl", value=url.url)
        return fn

    def _github_deploy_role(self, github_repo: str) -> None:
        """Role for GitHub Actions in this repo's production environment. Reuses the account's OIDC provider."""
        if not re.fullmatch(r"[\w.-]+(@\d+)?/[\w.-]+(@\d+)?", github_repo):
            raise ValueError("githubRepo must be owner/repo or owner@id/repo@id")
        synthesizer = self.synthesizer
        qualifier = (
            synthesizer.bootstrap_qualifier if isinstance(synthesizer, DefaultStackSynthesizer) else None
        ) or DefaultStackSynthesizer.DEFAULT_QUALIFIER
        provider_arn = f"arn:{self.partition}:iam::{self.account}:oidc-provider/{GITHUB}"
        role = iam.Role(
            self,
            "GitHubDeployRole",
            description=f"GitHub Actions deploys from {github_repo} (production environment only)",
            max_session_duration=Duration.hours(1),
            assumed_by=iam.WebIdentityPrincipal(  # pyright: ignore[reportArgumentType]
                provider_arn,
                conditions={
                    "StringEquals": {
                        f"{GITHUB}:aud": "sts.amazonaws.com",
                        f"{GITHUB}:sub": f"repo:{github_repo}:environment:production",
                    }
                },
            ),
        )
        # Deploys go through the CDK bootstrap roles.
        role.add_to_policy(
            iam.PolicyStatement(
                actions=["sts:AssumeRole"],
                resources=[f"arn:{self.partition}:iam::{self.account}:role/cdk-{qualifier}-*-{self.account}-{self.region}"],
            )
        )
        self.table.grant(role, "dynamodb:DescribeTable")  # smoke test
        NagSuppressions.add_resource_suppressions(
            role,
            [
                NagPackSuppression(
                    id="AwsSolutions-IAM5",
                    reason="Only sts:AssumeRole on this account's CDK bootstrap roles",
                    # Partition and account render as literals or tokens depending on flags and credentials.
                    applies_to=[RegexAppliesTo(regex=rf"/^Resource::arn:.+:iam::.+:role\/cdk-{qualifier}-\*-.+$/g")],
                )
            ],
            apply_to_children=True,
        )
        CfnOutput(self, "GitHubDeployRoleArn", value=role.role_arn)
