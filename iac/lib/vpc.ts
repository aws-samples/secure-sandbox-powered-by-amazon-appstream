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
import { CfnVPC } from 'aws-cdk-lib/aws-ec2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CustomRouteTable } from './route-table';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import { RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export interface VpcProps {
    readonly vpcConfig: any;
    readonly region: string;
    readonly account: string;
}

export class CustomVPC extends Construct {
    public readonly vpcId: string;
    public readonly listRouteTableIds: string [];
    public readonly listSubnetIds: string [];
    public readonly natGateways: string [];
    public readonly internetGateway: string;
    public readonly list_of_azs: string[];
    public readonly natSubnetsCIDRBlocks: string [];
    public readonly defaultSG: string;
    vpcFlowLogrole: iam.Role;
    public readonly customVpc: CfnVPC;

    constructor(scope: Construct, id: string, props: VpcProps) {
        super(scope, id);

        /** AZs where resources will be deployed */

        const selected_azs = props.vpcConfig.availabilityZones
    
        const vpc = new CfnVPC(this, "vpc", {
            cidrBlock: props.vpcConfig.cidrBlock,
            enableDnsHostnames: true,
            enableDnsSupport: true,
            tags: [{
                key: 'Name',
                value: id,
              }],
        });
        
        this.customVpc = vpc;

        /** KMS policy key to encrypt logs*/

        const flow_policy_statement = new iam.PolicyStatement({
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
                'kms:EncryptionContext:aws:logs:arn': ["arn:aws:logs:" + props.region + ":" + props.account + ":log-group:/vpcflowlogs/" + id],
              }
            }
          })
  
          flow_policy_statement.addServicePrincipal("logs.amazonaws.com");
  
          const flowPolicy = new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: [
                  'kms:*',
                ],
                principals: [new iam.AccountRootPrincipal()],
                resources: ['*'],
              }),
              flow_policy_statement
            ],
          });

        const log_group_vpc_key = new kms.Key(this, 'Log Group VPC Key', {
            enableKeyRotation: true,
            policy: flowPolicy,
            removalPolicy: RemovalPolicy.DESTROY
        });

        /** Enable Flow Logs */

        const logGroupVPCFlow = new logs.LogGroup(this, 'Log Group VPC Flow', {
            encryptionKey: log_group_vpc_key,
            logGroupName: "/vpcflowlogs/" + String(id),
            removalPolicy: RemovalPolicy.DESTROY
        });

        this.vpcFlowLogrole = new iam.Role(this, 'VPCFlowLogrole', {
            assumedBy: new iam.ServicePrincipal('vpc-flow-logs.amazonaws.com')
        });


        this.vpcFlowLogrole.attachInlinePolicy(new iam.Policy(this, 'VPCFlowLogRole', {
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

         // Enable adding suppressions to child constructs
        NagSuppressions.addResourceSuppressions(
          this.vpcFlowLogrole,
          [{ id: 'AwsSolutions-IAM5', reason: 'Only creates Flowlogs as per https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-cwl.html' }],
          true
        );

        const vpcFlowLog = new ec2.CfnFlowLog(this, 'MyCfnFlowLog', {
            resourceId: vpc.ref,
            resourceType: 'VPC',
            trafficType: 'ALL',
            deliverLogsPermissionArn: this.vpcFlowLogrole.roleArn,
            logDestination: logGroupVPCFlow.logGroupArn,
            logDestinationType: 'cloud-watch-logs',
            tags: [{
              key: 'Name',
              value: 'VPC-FlowLogs-' + id,
            }],
        });

        /** Create route tables based on configuration. Route tables names in cdk.json should have the following format:
         * 
         * 1. Public route tables:
         * 
         * VPC: "firewallRouteTable"
         * 
         * 2. NAT GW route tables:
         * 
         * "natRouteTableAz1","natRouteTableAz2","natRouteTableAz3"
         * 
         * 3. Private route tables (AppStream and gpu):
         * 
         * "privateRouteTableAz1","privateRouteTableAz2","privateRouteTableAz3"
         * 
         * 4. Internet Gateway Route Table. Routes incoming traffic towards Network Firewall Endpoint
         * 
         * "internetGatewayRouteTable"
         * 
         * Adjust number of az as needed in cdk-context.json, but follow the same naming convention. This format is needed in order to add the routes correctly to the table.
         */

        const route_tables = new CustomRouteTable(this, "route-tables-ids", {
            routeTablesNames: props.vpcConfig.routeTablesNames,
            vpcId: vpc.ref
        });

        /** Create each type of subnet (firewall, nat, appstream, gpu) in the selected AZs */

        const listOfSubnetIds: any = []
        const listOfNatGateways: any = []
        const listOfNatSubnetsCIDRBlocks: any = []
        let is_subnet_public = false;

        Object.keys(props.vpcConfig.subnetCIDRBlocks).forEach(key => {

            /** Logic on how many route tables to create. 1 route table for firewall subnets, as many route tables as AZs for the rest. 
             * AppStream and GPU share the same subnet, since they're routing towards the NAT GWs
             * Order goes like: 1st Firewall route table, 2 NAT GW, 3 Private
             */

            //Check if subnets are public, in order to enable automapping 

             if(key.toString() == ("firewallSubnets")){
                is_subnet_public = true
             }else{
                is_subnet_public = false
             }

            selected_azs.forEach((selected_az:any,index:any) => {
                const subnet = new ec2.CfnSubnet(this, key.toString() + '-subnet-' + (index+1), {
                    cidrBlock: props.vpcConfig.subnetCIDRBlocks[key][index],
                    vpcId: vpc.ref,
                    availabilityZone: selected_az,
                    mapPublicIpOnLaunch: is_subnet_public,
                    tags: [{
                        key: 'Name',
                        value: key.toString() + '-subnet-' + (index+1),
                    }],
                });

                listOfSubnetIds.push(subnet.ref);

                if(key.toString() == ("firewallSubnets")){

                    new ec2.CfnSubnetRouteTableAssociation(this, 'RouteTableAssociation-' + key.toString() + '-subnet-' + (index+1), {
                        routeTableId: route_tables.routeTablesIds[0],
                        subnetId: subnet.ref,
                    });  
                } else if(key.toString() == "natSubnets"){

                    new ec2.CfnSubnetRouteTableAssociation(this, 'RouteTableAssociation-' + key.toString() + '-subnet-' + (index+1), {
                        routeTableId: route_tables.routeTablesIds[index+1],
                        subnetId: subnet.ref,
                    });  

                    /** Create NAT GW */

                    const eip = new ec2.CfnEIP(this, 'EIP'+(index+1), {
                        domain: 'vpc',
                        tags: [{
                            key: 'Name',
                            value: 'EIP'+(index+1),
                        }],
                    });
                  
                    const natGateway = new ec2.CfnNatGateway(this, 'NatGateway'+(index+1), {
                        subnetId: subnet.ref,
                        allocationId: eip.attrAllocationId,
                        tags: [{
                            key: 'Name',
                            value: 'NatGateway'+(index+1),
                        }],
                    });

                    listOfNatGateways.push(natGateway.ref)
                    listOfNatSubnetsCIDRBlocks.push(subnet.cidrBlock)
        
                } else if(key.toString() == "appStreamSubnets"){
                    new ec2.CfnSubnetRouteTableAssociation(this, 'RouteTableAssociation-' + key.toString() + '-subnet-' + (index+1), {
                        routeTableId: route_tables.routeTablesIds[index+selected_azs.length+1],
                        subnetId: subnet.ref,
                    });  
                } else if (key.toString() == "gpuSubnets"){
                    new ec2.CfnSubnetRouteTableAssociation(this, 'RouteTableAssociation-' + key.toString() + '-subnet-' + (index+1), {
                        routeTableId: route_tables.routeTablesIds[index+selected_azs.length+1],
                        subnetId: subnet.ref,
                    });  
                }

            });
        });

        /** Internet gateway */

        const internetGateway = new ec2.CfnInternetGateway(this, 'InternetGateway', {
            tags: [{
                key: 'Name',
                value: 'InternetGateway',
            }],
        });

        new ec2.CfnVPCGatewayAttachment(this, 'IGWAttachment', {
          vpcId: vpc.ref,
          internetGatewayId: internetGateway.ref,
        });

        this.vpcId = vpc.ref;
        this.listRouteTableIds = route_tables.routeTablesIds;
        this.listSubnetIds = listOfSubnetIds;
        this.natGateways = listOfNatGateways;
        this.internetGateway = internetGateway.ref;
        this.list_of_azs = selected_azs;
        this.natSubnetsCIDRBlocks = listOfNatSubnetsCIDRBlocks;
        this.defaultSG = vpc.attrDefaultSecurityGroup;

        NagSuppressions.addResourceSuppressions(
            this.vpcFlowLogrole,
            [{ id: 'AwsSolutions-IAM5', reason: 'Only creates Flowlogs as per https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-cwl.html' }],
            true
          );
    }

    
}