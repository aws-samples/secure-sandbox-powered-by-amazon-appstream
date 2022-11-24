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
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';
import lambda = require('aws-cdk-lib/aws-lambda');
import * as path from 'path';
import cdk = require('aws-cdk-lib');
import { HttpApi } from '@aws-cdk/aws-apigatewayv2';
import { HttpMethod } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { NagSuppressions } from "cdk-nag";

export interface SSOURLProps {
    readonly region: string;
    readonly account: string;
    readonly userPoolId: string;
    readonly clientId: string;
    readonly fleet: string;
    readonly stack: string;
    readonly origin_domain: string;
}

export class CustomSSOURL extends Construct {
    public apiEndpoint: string;

    constructor(scope: Construct, id: string, props: SSOURLProps) {
        super(scope, id);

        const lambdaSSOURLlRole = new iam.Role(this, 'IAMRoleLambdaSSOURL', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
          });
    
          lambdaSSOURLlRole.attachInlinePolicy(new iam.Policy(this, 'LambdaPolicySSOURL', {
            statements: [
              new iam.PolicyStatement({
                actions: [ 'appstream:CreateStreamingURL' ],
                effect: iam.Effect.ALLOW,
                resources: [ 
                  `arn:aws:appstream:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:stack/${props.stack}`,
                  `arn:aws:appstream:${cdk.Stack.of(scope).region}:${cdk.Stack.of(scope).account}:fleet/${props.fleet}` 
                ]
              }),
              new iam.PolicyStatement({
                actions: [ 'logs:CreateLogStream','logs:PutLogEvents', 'logs:CreateLogGroup' ],
                effect: iam.Effect.ALLOW,
                resources: [ '*' ]
              })
            ]
        }))

        const lambdaSSOURL = new lambda.Function(this, 'LambdaSSOURL', {
          code: lambda.Code.fromAsset(path.join(__dirname, '../../src/sso_url/dist/code.zip')),
          handler: 'index.handler',
          timeout: cdk.Duration.seconds(300),
          architecture: lambda.Architecture.ARM_64,
          runtime: lambda.Runtime.NODEJS_16_X,
          role: lambdaSSOURLlRole,
          environment: {
            fleet: props.fleet,
            stack: props.stack,
            origin_domain: props.origin_domain,
          },
        });

        NagSuppressions.addResourceSuppressions(lambdaSSOURL, [{id: "AwsSolutions-L1", reason: "Will upgrade to latest node JS version in future release"}]);

        /** KMS KEY */

      const api_gw_policy_statement = new iam.PolicyStatement({
        actions: [
          'kms:Encrypt*',
          'kms:Decrypt*',
          'kms:ReEncrypt*',
          'kms:GenerateDataKey*',
          'kms:Describe*',
        ],
        resources: ['*'],
        conditions: {
          'ArnEquals': {
            'kms:EncryptionContext:aws:logs:arn': ["arn:aws:logs:" + props.region + ":" + props.account + ":log-group:/apigw"],
          }
        }
      })

      api_gw_policy_statement.addServicePrincipal("logs.amazonaws.com");

      const api_gw_Policy = new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: [
              'kms:*',
            ],
            principals: [new iam.AccountRootPrincipal()],
            resources: ['*'],
          }),
          api_gw_policy_statement
        ],
      });

      const log_group_api_gw_key = new kms.Key(this, 'Log Group API GW Key', {
          enableKeyRotation: true,
          policy: api_gw_Policy,
          removalPolicy: RemovalPolicy.DESTROY
      });

      /** Log group */

      const logGroupAPIGW = new logs.LogGroup(this, 'Log Group API GW', {
        encryptionKey: log_group_api_gw_key,
        logGroupName: "/apigw",
        removalPolicy: RemovalPolicy.DESTROY
      });

      const apiGwLogrole = new iam.Role(this, 'apiGwLogrole', {
          assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com')
      });

      apiGwLogrole.attachInlinePolicy(new iam.Policy(this, 'APIGWLogRole', {
          statements: [
            new iam.PolicyStatement({
              actions: [
                  "logs:CreateLogGroup",
                  "logs:CreateLogStream",
                  "logs:PutLogEvents",
                  "logs:DescribeLogGroups",
                  "logs:DescribeLogStreams"
                ],
              effect: iam.Effect.ALLOW,
              resources: [ '*' ]
            })
          ]
      }));

        const cfnApi = new apigatewayv2.CfnApi(this, 'MyCfnApi',  {
            description: 'HTTP API for Lambda SSO URL',
            name: 'HTTP_API_SSO_URL',
            protocolType: 'HTTP',
            corsConfiguration: {
              allowOrigins: [props.origin_domain, 'https://localhost:8080'],
              allowMethods: [HttpMethod.GET],
              allowHeaders: ["*"],
            }
          });

        /** Authorizer Cognito */

        const cfnAuthorizer = new apigatewayv2.CfnAuthorizer(this, 'MyCfnAuthorizer', {
          apiId: cfnApi.ref,
          authorizerType: 'JWT',
          name: 'CognitoAuthorizer',
        
          identitySource: ['$request.header.Authorization'],
          jwtConfiguration: {
            audience: [props.clientId],
            issuer: "https://cognito-idp." + props.region + ".amazonaws.com/" + props.userPoolId,
          },
        });

        /** Integration with Lambda */

        const cfnIntegration = new apigatewayv2.CfnIntegration(this, 'MyCfnIntegration', {
            apiId: cfnApi.ref,
            integrationType: 'AWS_PROXY',
            description: 'Integration with Lambda',
            integrationUri: lambdaSSOURL.functionArn,
            payloadFormatVersion: '2.0',
        });

        /** Route to Lambda */

        const cfnRoute = new apigatewayv2.CfnRoute(this, 'MyCfnRoute', {
            apiId: cfnApi.ref,
            routeKey: 'GET /sso_url_lambda',
            authorizationType: "JWT",
            target: 'integrations/' + cfnIntegration.ref,
            authorizerId: cfnAuthorizer.ref
        });

        /** API GW stage */

        const cfnStage = new apigatewayv2.CfnStage(this, 'MyCfnStage', {
            apiId: cfnApi.ref,
            stageName: 'Development',

            accessLogSettings: {
                destinationArn: logGroupAPIGW.logGroupArn,
                format: '$context.requestId',
            },
            autoDeploy: true,
            description: 'HTTP API GW Stage',
            });

        this.apiEndpoint = `${cfnApi.attrApiEndpoint}/${cfnStage.stageName}`;

        /** Grant invoke permissions to API GW */
        
        const apigwPrincipal = new iam.ServicePrincipal('apigateway.amazonaws.com');
        const apigwPrincipalWithCondition = apigwPrincipal.withConditions({
          StringEquals: {
            'aws:SourceArn': "arn:aws:execute-api:" + props.region + ":" + props.account + ":" + cfnApi.ref + "/*/*",
          },
        });

        lambdaSSOURL.addPermission('Invocation', {
            principal: apigwPrincipal,
            action: "lambda:InvokeFunction",
            sourceArn: "arn:aws:execute-api:" + props.region + ":" + props.account + ":" + cfnApi.ref + "/*/*" //+ "/sso_url_lambda"
        });
    }
}

