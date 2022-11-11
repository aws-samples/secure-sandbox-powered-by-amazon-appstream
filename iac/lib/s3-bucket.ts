/**   Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
  
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  
      http://www.apache.org/licenses/LICENSE-2.0
  
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License. */

import { Construct } from 'constructs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Key } from 'aws-cdk-lib/aws-kms';
import { PrincipalBase, Role } from 'aws-cdk-lib/aws-iam';
import { CfnVPCEndpoint } from 'aws-cdk-lib/aws-ec2';
import { throws } from 'assert';

export interface S3BucketProps {
    readonly bucketName: string;
    readonly logsbucket: any;
    readonly use_s3_sse?: boolean;
}

export class CustomS3Bucket extends Construct {
    public readonly s3_bucket: Bucket;
    public readonly kms_key: Key;

    grantReadWrite = (principal: Role) => {
        this.s3_bucket.grantReadWrite(principal);
        this.kms_key.grantEncryptDecrypt(principal);
    }

    grantRead = (principal: Role) => {
        this.s3_bucket.grantRead(principal);
        this.kms_key.grantDecrypt(principal);
    }

    getRestrictPolicyTemplate = (vpce: CfnVPCEndpoint) => {
        const restrictedPolicyStatement = new iam.PolicyStatement({
            actions: [
            ],
            resources: [
              this.s3_bucket.bucketArn,
              this.s3_bucket.arnForObjects("*"),
            ],
            principals: [new iam.AnyPrincipal()],
            effect: iam.Effect.DENY,
            conditions: {
              StringNotEquals: {
                "aws:sourceVpce": [vpce.ref],
              },
            },
          });

        return restrictedPolicyStatement;
    }

    limitReadTo = (vpce: CfnVPCEndpoint) => {
        const policyStatement = this.getRestrictPolicyTemplate(vpce);
        policyStatement.addActions("s3:GetObject")
        this.s3_bucket.addToResourcePolicy(policyStatement);
    }

    limitWriteTo = (vpce: CfnVPCEndpoint) => {
        const policyStatement = this.getRestrictPolicyTemplate(vpce);
        policyStatement.addActions("s3:PutObject")
        this.s3_bucket.addToResourcePolicy(policyStatement);
    }

    limitAllAccessTo = (vpce: CfnVPCEndpoint) => {
        this.limitReadTo(vpce);
        this.limitWriteTo(vpce);
    }

    constructor(scope: Construct, id: string, props: S3BucketProps) {
        super(scope, id);

        const encryptionConfig = {
            encryption: s3.BucketEncryption.S3_MANAGED,
        }

        if (!props.use_s3_sse) {

            const kms_key = new kms.Key(this, props.bucketName + 's3_bucket_key', {
                enableKeyRotation: true,
                removalPolicy: RemovalPolicy.DESTROY
            });
            encryptionConfig.encryption = s3.BucketEncryption.KMS
            Object.assign(encryptionConfig, { encryptionKey : kms_key})
            this.kms_key = kms_key;
        }

        if (props.logsbucket == null){
            const created_s3_bucket = new s3.Bucket(this, props.bucketName, {
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                publicReadAccess: false,
                removalPolicy: RemovalPolicy.DESTROY,
                ...encryptionConfig,
            });
            this.s3_bucket = created_s3_bucket;
        } else{
            const created_s3_bucket = new s3.Bucket(this, props.bucketName, {
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                publicReadAccess: false,
                removalPolicy: RemovalPolicy.DESTROY,
                serverAccessLogsBucket: props.logsbucket,
                ...encryptionConfig,
            });
            this.s3_bucket = created_s3_bucket;
        }

        

    }
}