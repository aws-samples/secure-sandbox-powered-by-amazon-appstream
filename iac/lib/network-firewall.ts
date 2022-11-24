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
import * as networkfirewall from "aws-cdk-lib/aws-networkfirewall";
import { CustomANFW } from './custom-resource';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as iam from 'aws-cdk-lib/aws-iam';
import { RemovalPolicy } from 'aws-cdk-lib';


export interface NetworkFirewallProps {
    readonly allowed_domains_context: string [];
    readonly list_subnet_ids: string [];
    readonly vpcId: string;
    readonly list_of_azs: string[];
    readonly region: string;
    readonly account: string;
}

export class CustomNetworkFirewall extends Construct {
    public readonly listNetworkFirewallEndpoints: string [];

    constructor(scope: Construct, id: string, props: NetworkFirewallProps) {
        super(scope, id);

        /** Network firewal rule group */

        const ruleGroup = new networkfirewall.CfnRuleGroup(this, 'StatefulDomainListRuleGroup', {
            capacity: 20,
            ruleGroupName: 'StatefulDomainListRuleGroup',
            type: 'STATEFUL',
          
            description: 'Stateful domain list rule group',
            ruleGroup: {
              rulesSource: {
                rulesSourceList: {
                  generatedRulesType: 'ALLOWLIST',
                  targets: props.allowed_domains_context,
                  targetTypes: ['TLS_SNI','HTTP_HOST'],
                },
              },
            },
            tags: [{
                key: 'Name',
                value: "StatefulDomainListRuleGroup",
              }],
          });

        /** Network firewally policy */

        const firewallPolicy = new networkfirewall.CfnFirewallPolicy(this, 'FirewallPolicy', {
            firewallPolicy: {
            statelessDefaultActions: ['aws:forward_to_sfe'],
            statelessFragmentDefaultActions: ['aws:forward_to_sfe'],
        
            statefulRuleGroupReferences: [{
                resourceArn: ruleGroup.attrRuleGroupArn,
            }],
            },
            firewallPolicyName: 'AppStreamFirewallPolicy',
            description: 'Firewall Policy for AppStream',
            tags: [{
                key: 'Name',
                value: "FirewallPolicy",
              }],
        });
  
        /** Network firewall */
    
        const networkFirewallSubnetMappings: any = [];

        // Public subnets come first in the list of subnets

        for(let i=0; i<props.list_of_azs.length;i++){
            networkFirewallSubnetMappings.push({subnetId: props.list_subnet_ids[i]})
        }
  
        const networkFirewall = new networkfirewall.CfnFirewall(this, 'NetworkFirewall', {
            firewallName: 'AppStreamNetworkFirewall',
            firewallPolicyArn: firewallPolicy.attrFirewallPolicyArn,
            subnetMappings: networkFirewallSubnetMappings,
            vpcId: props.vpcId,
            description: 'Network Firewall for AppStream',
            tags: [{
                key: 'Name',
                value: "NetworkFirewall",
            }],
        });

        /** KMS policy key to encrypt logs: FLOW */

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
              'kms:EncryptionContext:aws:logs:arn': ["arn:aws:logs:" + props.region + ":" + props.account + ":log-group:/networkfirewall/flow"],
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

        /** KMS policy key to encrypt logs: ALERT */

        const alert_policy_statement = new iam.PolicyStatement({
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
              'kms:EncryptionContext:aws:logs:arn': ["arn:aws:logs:" + props.region + ":" + props.account + ":log-group:/networkfirewall/alert"],
            }
          }
        })

        alert_policy_statement.addServicePrincipal("logs.amazonaws.com");

        const alertPolicy = new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                'kms:*',
              ],
              principals: [new iam.AccountRootPrincipal()],
              resources: ['*'],
            }),
            alert_policy_statement
          ],
        });

        /** Log groups for NetworkFirewall */

        const log_group_flow_key = new kms.Key(this, 'Log Group Flow Key', {
            enableKeyRotation: true,
            policy: flowPolicy,
            removalPolicy: RemovalPolicy.DESTROY
        });

        const log_group_alert_key = new kms.Key(this, 'Log Group Alert Key', {
          enableKeyRotation: true,
          policy: alertPolicy,
          removalPolicy: RemovalPolicy.DESTROY
        });

        const logGroupFlow = new logs.LogGroup(this, 'Log Group Flow', {
            encryptionKey: log_group_flow_key,
            logGroupName: "/networkfirewall/flow",
            removalPolicy: RemovalPolicy.DESTROY
        });

        const logGroupAlert = new logs.LogGroup(this, 'Log Group Alert', {
            encryptionKey: log_group_alert_key,
            logGroupName: "/networkfirewall/alert",
            removalPolicy: RemovalPolicy.DESTROY
        });


        /** Logging configuration */

        const loggingConfiguration = new networkfirewall.CfnLoggingConfiguration(this, 'LoggingConfiguration', {
            firewallArn: networkFirewall.attrFirewallArn,
            loggingConfiguration: {
              logDestinationConfigs: [{
                logDestination: {
                  logGroup: logGroupFlow.logGroupName,
                },
                logDestinationType: 'CloudWatchLogs',
                logType: 'FLOW',
              },
              {
                logDestination: {
                  logGroup: logGroupAlert.logGroupName,
                },
                logDestinationType: 'CloudWatchLogs',
                logType: 'ALERT',
              }],
            },
          });

        /** Custom resource to retrieve endpoints IDs*/
    
        const resource = new CustomANFW(this, 'ANFW', {
            azs: props.list_of_azs,
            networkfirewall: networkFirewall.attrFirewallArn,
        });
  
        this.listNetworkFirewallEndpoints = resource.listNetworkFirewallEndpoints;

    }
}