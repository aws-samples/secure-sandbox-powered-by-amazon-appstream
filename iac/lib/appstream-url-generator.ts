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

import { Duration, RemovalPolicy } from "aws-cdk-lib";
import { Construct } from "constructs";
import { CustomS3Bucket } from "./s3-bucket";
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { NagSuppressions } from "cdk-nag";
import { throws } from "assert";
import { CustomSSOURL } from "./sso-url-generation";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import * as path from 'path';
import * as fs from 'fs';
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";

export interface AppStreamURLGeneratorProps {
    logs_bucket: s3.Bucket
    region: string,
    account: string,
    appstream_stack:string, 
    appstream_fleet:string,
    userPoolDomain: string,
    
    spaCustomURL?: string,
    spaCustomCertificate?: Certificate,
}

export class AppStreamURLGenerator extends Construct {
    public static_content_bucket: s3.Bucket
    public cognitoDomain: string
    public cloudfrontFQDN: string
    public apiEndpoint: string
    public userPoolClientId: string
    public userPoolId: string
    
    constructor(scope: Construct, id: string, props: AppStreamURLGeneratorProps) {
        super(scope, id);

    /** Cognito User Pool */

    const cognito_user_pool = new cognito.UserPool(this, 'cognito_user_pool', {
        userPoolName: 'cognito_user_pool',
        signInAliases: {
          username: false,
          email: true,
          phone: false
        },
        autoVerify: { 
          email: false
        },
        passwordPolicy: {
          minLength: 12,
          requireLowercase: true,
          requireUppercase: true,
          requireDigits: true,
          requireSymbols: true,
          tempPasswordValidity: Duration.days(3),
        },
        
      });

      const upd = new cognito.UserPoolDomain(this, "upd", {
         userPool: cognito_user_pool,
         cognitoDomain: {domainPrefix: props.userPoolDomain}, 
      });
  
  
      const cognito_pool_cfn = cognito_user_pool.node.defaultChild as cognito.CfnUserPool;
      cognito_pool_cfn.addPropertyOverride('UserPoolAddOns', {AdvancedSecurityMode: "ENFORCED"});
      NagSuppressions.addResourceSuppressions(cognito_user_pool, [{id: "AwsSolutions-COG3", reason: "added override"}]);
  
      cognito_user_pool.applyRemovalPolicy(RemovalPolicy.DESTROY);

    /** Static website : CloudFront + S3 bucket*/

    const static_content_bucket = new CustomS3Bucket(this,"static_content_s3_bucket", {
      bucketName: "static_content_s3_bucket",
      logsbucket: props.logs_bucket,
      use_s3_sse: true,
    })
    this.static_content_bucket = static_content_bucket.s3_bucket;

    const distribution = new cloudfront.Distribution(this, 'cloudfront_distribution', {
      defaultBehavior: { origin: new origins.S3Origin(this.static_content_bucket), viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS },
      defaultRootObject: "index.html",
      enableLogging: true,
      logBucket: props.logs_bucket,
    });

    NagSuppressions.addResourceSuppressions(distribution, [{id: "AwsSolutions-CFR4", reason: "Sample Web App to get AppStream URL"}]);

    /** Cognito User Pool Client */

    const cognito_user_pool_client = new cognito.UserPoolClient(this, 'cognito_user_pool_client', {
        userPool: cognito_user_pool,
        authFlows: {
          userPassword: true,
          userSrp: true,
          adminUserPassword: true
        },
        supportedIdentityProviders: [
          cognito.UserPoolClientIdentityProvider.COGNITO,
        ],
        oAuth: {
          callbackUrls: [`https://${distribution.domainName}`, `https://localhost:8080`],
          flows: {
            authorizationCodeGrant: true,
            implicitCodeGrant: false,
            clientCredentials: false
          },
          scopes: [ cognito.OAuthScope.OPENID,cognito.OAuthScope.EMAIL, cognito.OAuthScope.COGNITO_ADMIN, cognito.OAuthScope.PHONE, cognito.OAuthScope.PROFILE ]
        },
      });

      
      const spaBundlePath = path.join(__dirname, '../../src/ssospa/build');
      let spa_source; 
      if (fs.existsSync(spaBundlePath)) {
        spa_source = Source.asset(spaBundlePath);
      } else {
        
      }
    
      if (spa_source) {
      const spa_deployment = new BucketDeployment(
          this,
          "spadeploy2",
          {
            destinationBucket:static_content_bucket.s3_bucket,
            sources:[spa_source],
            distribution:distribution,
          }
      )
        }

    /** Streaming URL for AppStream - API Gateway + Lambda. */

    const sso_url_generation = new CustomSSOURL(this, "sso_url_generation", {
      region: props.region,
      account: props.account,
      userPoolId: cognito_user_pool.userPoolId,
      clientId: cognito_user_pool_client.userPoolClientId,
      fleet: props.appstream_fleet,
      stack: props.appstream_stack,
      origin_domain: `https://${distribution.domainName}`,
    });

    this.cognitoDomain = upd.domainName;
    this.cloudfrontFQDN = distribution.domainName;
    this.apiEndpoint = sso_url_generation.apiEndpoint;
    this.userPoolClientId = cognito_user_pool_client.userPoolClientId;
    this.userPoolId = cognito_user_pool.userPoolId;
}}

    