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

import { aws_appstream as appstream } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CfnSecurityGroup } from 'aws-cdk-lib/aws-ec2';
import * as aws from 'aws-sdk';
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from 'cdk-nag';
export interface AppStreamProps {
    readonly vpcId: string;
    readonly stagingBucketARN: string;
    readonly listAppStreamSubnets: string[];
    readonly region: string;
    readonly imageName: string;
    readonly desiredCapacity?: number;
    readonly appStreamRole: iam.Role;
    readonly userSettings: any;
}

export class CustomAppStream extends Construct {
    public readonly fleetName: string;
    public readonly stackName: string;
    public readonly fleetSecurityGroup: CfnSecurityGroup;

    constructor(scope: Construct, id: string, props: AppStreamProps) {
        super(scope, id);

        /** Check if service role exists. If not, create it */
          var iam_aws_sdk = new aws.IAM();

          var params = {
            RoleName: "AmazonAppStreamServiceAccess"
          };
          
          iam_aws_sdk.getRole(params, (err, data) => {
            if (err) {
              //Create service role
              const appStreamServiceRole = new iam.Role(this, "AppStreamServiceRole", {
                assumedBy: new iam.ServicePrincipal("appstream.amazonaws.com"),
              });

              appStreamServiceRole.addManagedPolicy(
                iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonAppStreamServiceAccess")
              );

              NagSuppressions.addResourceSuppressions(
                appStreamServiceRole,
                [{ id: 'AwsSolutions-IAM4', reason: 'Needed Managed IAM policy' }],
                true
              );
            }           
          });



        /** AppStrem fleet*/

        const appStreamsecurityGroup = new ec2.CfnSecurityGroup(
          this,
          "AppStreamSG",
          {
            vpcId: props.vpcId,
            groupDescription: 'SGAppStream',
            groupName: 'SGAppStream',
            securityGroupEgress: [{
              cidrIp: "0.0.0.0/0",
              ipProtocol: "tcp",
              fromPort:443,
              toPort:443,
            }]
          },
        )
        this.fleetSecurityGroup = appStreamsecurityGroup;

        const appStreamVPCEsecurityGroup = new ec2.CfnSecurityGroup(
          this,
          "AppStreamVPCESG",
          {
            vpcId: props.vpcId,
            groupDescription: 'SGAppStreamVPCE',
            groupName: 'SGAppStreamVPCE',
            securityGroupIngress: [{
              sourceSecurityGroupId: appStreamsecurityGroup.ref,
              fromPort:443,
              toPort:443,
              ipProtocol: "tcp",
            }]
          },
        )

        const cfnFleet = new appstream.CfnFleet(this, 'AppStreamFleet', {
            instanceType: 'stream.standard.small',
            name: 'AppStreamFleet',
          
            computeCapacity: {
                desiredInstances: props.desiredCapacity || 5
            },
            iamRoleArn: props.appStreamRole.roleArn,
            description: 'AppStreamFleet',
            disconnectTimeoutInSeconds: 3600,
            displayName: 'AppStreamFleet',
            fleetType: 'ON_DEMAND',
            idleDisconnectTimeoutInSeconds: 300,
            imageName: props.imageName,
            maxUserDurationInSeconds: 7200,
            streamView: 'DESKTOP',
            tags: [{
              key: 'Name',
              value: 'AppStreamFleet',
            }],
            vpcConfig: {
              securityGroupIds: [appStreamsecurityGroup.ref],
              subnetIds: [props.listAppStreamSubnets[0],props.listAppStreamSubnets[1]], //Max 2 subnets
            },
          });
        
        const cfnStack = new appstream.CfnStack(this, 'AppStreamStack', /* all optional props */ {
          applicationSettings: {
            enabled: false
          },
          description: 'AppStreamStack',
          displayName: 'AppStreamStack',
          name: 'AppStreamStack',
          storageConnectors: [{
            connectorType: 'HOMEFOLDERS',
          }],
          userSettings: props.userSettings,
          tags: [{
            key: 'Name',
            value: 'AppStreamStack',
          }],
      });

        /** Stack fleet association */

        const cfnStackFleetAssociation = new appstream.CfnStackFleetAssociation(this, 'StackFleetAssociation', {
            fleetName: cfnFleet.ref,
            stackName: cfnStack.ref,
        });

        this.fleetName = cfnFleet.name;
        this.stackName = "AppStreamStack";

    }
}