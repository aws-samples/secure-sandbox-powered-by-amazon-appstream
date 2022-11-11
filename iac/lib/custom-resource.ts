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

import cdk = require('aws-cdk-lib');
import lambda = require('aws-cdk-lib/aws-lambda');
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export interface MyCustomResourceProps extends cdk.ResourceProps {
  readonly azs: string [];
  readonly networkfirewall: string;
}

export class CustomANFW extends Construct {
  public readonly listNetworkFirewallEndpoints: string[];

  constructor(scope: Construct, id: string, props: MyCustomResourceProps) {
    super(scope, id);

    const lambdaRoleNetworkFirewallRole = new iam.Role(this, 'IAMRoleLambdaNetworkFirewall', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      });

      lambdaRoleNetworkFirewallRole.attachInlinePolicy(new iam.Policy(this, 'LambdaPolicyFirewall', {
        statements: [
          new iam.PolicyStatement({
            actions: [ 'network-firewall:DescribeFirewall' ],
            effect: iam.Effect.ALLOW,
            resources: [ '*' ]
          }),
          new iam.PolicyStatement({
            actions: [ 'logs:CreateLogStream','logs:PutLogEvents', 'logs:CreateLogGroup' ],
            effect: iam.Effect.ALLOW,
            resources: [ '*' ]
          })
        ]
    }))

    const lambdaNetworkFirewall = new lambda.Function(this, 'CustomResourceLambda', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../../src/lambdaFirewall')),
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(300),
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_16_X,
      role: lambdaRoleNetworkFirewallRole,
    });

    const resource = new cdk.CustomResource(this, 'Resource', {
      serviceToken: lambdaNetworkFirewall.functionArn,
      properties: props,
    });

    const nfwendpoints: any = [];

    for(let i=0; i<props.azs.length;i++){
      nfwendpoints.push(resource.getAttString('fwvpceid'+(i+1)));
    }

    this.listNetworkFirewallEndpoints = nfwendpoints;

  }
}