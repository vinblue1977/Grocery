#!/usr/bin/env python3
"""CDK entry point. `cdk synth` also runs cdk-nag's AWS Solutions security checks."""

import os

import aws_cdk as cdk
from cdk_nag import AwsSolutionsChecks

from infra.stack import GroceryStack

app = cdk.App()
GroceryStack(
    app,
    "Grocery",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region="us-east-2",  # fixed: the CDK CLI defaults to us-east-1 without credentials
    ),
    termination_protection=True,
    description="Shared iPhone grocery list: stores, items and frequent items for two people",
)
cdk.Tags.of(app).add("project", "grocery")
cdk.Aspects.of(app).add(AwsSolutionsChecks(verbose=True))
app.synth()
