import os

import boto3
import pytest
from moto import mock_aws

from api import handler


@pytest.fixture
def table():
    os.environ.update(
        TABLE_NAME="test-table",
        AWS_DEFAULT_REGION="us-east-2",
        AWS_ACCESS_KEY_ID="x",
        AWS_SECRET_ACCESS_KEY="x",
        BEDROCK_MODEL_ID="us.anthropic.test-model",
    )
    with mock_aws():
        db = boto3.resource("dynamodb")
        db.create_table(
            TableName="test-table",
            KeySchema=[{"AttributeName": "PK", "KeyType": "HASH"}, {"AttributeName": "SK", "KeyType": "RANGE"}],
            AttributeDefinitions=[{"AttributeName": "PK", "AttributeType": "S"}, {"AttributeName": "SK", "AttributeType": "S"}],
            BillingMode="PAY_PER_REQUEST",
        )
        handler.get_table.cache_clear()
        yield db.Table("test-table")
        handler.get_table.cache_clear()
