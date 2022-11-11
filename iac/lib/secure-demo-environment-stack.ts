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

import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as kms from "aws-cdk-lib/aws-kms";
import * as iam from "aws-cdk-lib/aws-iam";
import { Effect } from "aws-cdk-lib/aws-iam";
import { CustomVPC } from "./vpc";
import { CustomRouteConfig } from "./route-config";
import { CustomNetworkFirewall } from "./network-firewall";
import { CustomS3Bucket } from "./s3-bucket";
import { RemovalPolicy } from "aws-cdk-lib";
import { CustomSSOURL } from "./sso-url-generation";
import { CustomAppStream } from "./appstream";
import { NagPackSuppression, NagSuppressions } from "cdk-nag";
import { InterfaceVpcEndpointAwsService } from "aws-cdk-lib/aws-ec2";
import { AppStreamURLGenerator } from "./appstream-url-generator";
import { ImagePullPrincipalType } from "aws-cdk-lib/aws-codebuild";
import { GPUInstance } from "./gpu_instance";
import { access } from "fs";

export class SecureDemoEnvironmentStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const spaCustomCertificate = undefined;
    const spaCustomURL = undefined;
    /** Get account and region */

    const account = Stack.of(this).account;
    const region = Stack.of(this).region;

    /** VPC with three subnets: one public, and two private for Workspaces and GPU.
     * Also includes VPC endpoint for S3
     */

    const vpc_context = this.node.tryGetContext("vpcConfig");

    const vpc = new CustomVPC(this, "secure-demo-environment-vpc", {
      vpcConfig: vpc_context,
      account: account,
      region: region,
    });

    const listRouteTableIds = vpc.listRouteTableIds;
    const listSubnetIds = vpc.listSubnetIds;

    const privateRouteTables = listRouteTableIds.slice(4, 7);

    /** Network firewall */

    const allowed_domains_context = Object(
      this.node.tryGetContext("allowedDomainsNetworkFirewall")
    );

    const networkFirewall = new CustomNetworkFirewall(
      this,
      "network-firewall",
      {
        allowed_domains_context: allowed_domains_context,
        list_subnet_ids: vpc.listSubnetIds,
        vpcId: vpc.vpcId,
        list_of_azs: vpc.list_of_azs,
        region: region,
        account: account,
      }
    );

    /** Configuring routes */

    const vpc_route_config = new CustomRouteConfig(
      this,
      "vpc-route-config",
      {
        routeTablesIds: listRouteTableIds,
        routeTablesNames: vpc_context.routeTablesNames,
        internetGatewayId: vpc.internetGateway,
        natGatewaysIds: vpc.natGateways,
        nfw_endpointsIds: networkFirewall.listNetworkFirewallEndpoints,
        nfw_subnets_cidr_blocks: vpc.natSubnetsCIDRBlocks,
        list_of_azs: vpc.list_of_azs,
      }
    );

    /** Select appstream subnets. VPC endpoints can be associated only with one subnet per az, but they can be used
     * by the other subnets in the az. First range of subnets are public, second one are for NAT GW, and the third
     * one is for AppStream subnets.
     */

    const appstream_subnet_ids = listSubnetIds.slice(
      2 * vpc.list_of_azs.length,
      3 * vpc.list_of_azs.length
    );

    const vpcEndpointSG = new ec2.CfnSecurityGroup(this, "SGVPCE", {
      vpcId: vpc.vpcId,
      groupDescription: "SGVPCE",
      groupName: "SGVPCE",
    });

    /** VPC Endpoints */

    const ssmEndpointPolicyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          principals: [new iam.AnyPrincipal()],
          actions: ["ssm:*", "ec2messages:*", "ssmmessages:*", "ec2:*"],
          resources: ["*"],
        }),
      ],
    });

    const ssm_endpoint = new ec2.CfnVPCEndpoint(this, "SSMEndpoint", {
      serviceName: "com.amazonaws." + region + ".ssm",
      vpcId: vpc.vpcId,
      policyDocument: ssmEndpointPolicyDocument,
      securityGroupIds: [vpcEndpointSG.ref],
      subnetIds: appstream_subnet_ids,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
    });

    const ec2_endpoint = new ec2.CfnVPCEndpoint(this, "EC2Endpoint", {
      serviceName: "com.amazonaws." + region + ".ec2",
      vpcId: vpc.vpcId,
      policyDocument: ssmEndpointPolicyDocument,
      securityGroupIds: [vpcEndpointSG.ref],
      subnetIds: appstream_subnet_ids,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
    });

    const ssm_ec2_endpoint = new ec2.CfnVPCEndpoint(this, "SSMEC2Endpoint", {
      serviceName: "com.amazonaws." + region + ".ec2messages",
      vpcId: vpc.vpcId,
      policyDocument: ssmEndpointPolicyDocument,
      securityGroupIds: [vpcEndpointSG.ref],
      subnetIds: appstream_subnet_ids,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
    });

    const ssm_messages_endpoint = new ec2.CfnVPCEndpoint(this, "SSMMessagesEndpoint", {
      serviceName: "com.amazonaws." + region + ".ssmmessages",
      vpcId: vpc.vpcId,
      policyDocument: ssmEndpointPolicyDocument,
      securityGroupIds: [vpcEndpointSG.ref],
      subnetIds: appstream_subnet_ids,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
    });

    const stsEndpointPolicyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          principals: [new iam.AnyPrincipal()],
          actions: ["sts:*"],
          resources: ["*"],
        }),
      ],
    });

    const sts_endpoint = new ec2.CfnVPCEndpoint(this, "STSEndpoint", {
      serviceName: "com.amazonaws." + region + ".sts",
      vpcId: vpc.vpcId,
      policyDocument: stsEndpointPolicyDocument,
      securityGroupIds: [vpcEndpointSG.ref],
      subnetIds: appstream_subnet_ids,
      vpcEndpointType: "Interface",
      privateDnsEnabled: true,
    });

    /** S3 bucket to store logs + KMS key */

    const logs_bucket = new CustomS3Bucket(this, "logs_s3_bucket", {
      bucketName: "logs_s3_bucket",
      logsbucket: null,
    });

    /** Staging S3 bucket + KMS key */

    const staging_bucket = new CustomS3Bucket(this, "staging_s3_bucket2", {
      bucketName: "staging_s3_bucket2",
      logsbucket: logs_bucket.s3_bucket,
    });

    /** VPC Interface Endpoint for S3*/
    const endpointAllowedBuckets = [
      staging_bucket
    ];

    const endpointAllowedBucketArns = new Array<string>();
    endpointAllowedBuckets.forEach( bucket => {
      const bucketArn = bucket.s3_bucket.bucketArn
      const itemArns = `${bucketArn}/*`
      endpointAllowedBucketArns.push(bucketArn);
      endpointAllowedBucketArns.push(itemArns);
    })

    const s3EndpointPolicyDocument = new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          principals: [new iam.AnyPrincipal()],
          actions: ["s3:*"],
          resources: [
            ...endpointAllowedBucketArns,
            `arn:aws:s3:::appstream2-36fb080bb8-${region}-${account}`,
            `arn:aws:s3:::appstream2-36fb080bb8-${region}-${account}/*`,
            `arn:aws:s3:::appstream-app-settings-${region}-${account}`,
            `arn:aws:s3:::appstream-app-settings-${region}-${account}/*`,
          ],
        }),
      ],
    });

    const s3Endpoint = new ec2.CfnVPCEndpoint(this, "S3EndpointGW", {
      serviceName: "com.amazonaws." + region + ".s3",
      vpcId: vpc.vpcId,
      policyDocument: s3EndpointPolicyDocument,
      routeTableIds: privateRouteTables,
      vpcEndpointType: "Gateway",
    });

    /** Adding bucket policy to restrict access to buckets*/

    staging_bucket.limitReadTo(s3Endpoint);

    /** GPU instance */

    const gpuContext = this.node.tryGetContext("gpuInstanceConfig");

    const gpu_subnet_ids = listSubnetIds.slice(
      3 * vpc.list_of_azs.length,
      4 * vpc.list_of_azs.length
    );

    /** Give access to S3 bucket for GPU instance */

    const gpu_role = new iam.Role(this, "gpuRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
    });

    gpu_role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    staging_bucket.grantRead(gpu_role);

    const gpuInstanceProfile = new iam.CfnInstanceProfile(
      this,
      "GPUInstanceProfile",
      {
        roles: [gpu_role.roleName],
        instanceProfileName: "gpuInstanceProfile",
      }
    );

    const gpuInstance = new GPUInstance(this, "GPU-instance", {
      vpc_id: vpc.vpcId,
      gpu_subnets: gpu_subnet_ids,
      gpuInstanceProfile: gpuInstanceProfile.ref,
      gpuContext: gpuContext,
    });

    /** AppStream */

    const appStreamImageName =
      this.node.tryGetContext("appStreamConfig").imageName;

    const appStreamRole = new iam.Role(this, "appstreamrole", {
      assumedBy: new iam.ServicePrincipal("appstream.amazonaws.com"),
    });

    const accessGPUFromAppStreamPolicy = new iam.ManagedPolicy(this, "as2gpu", {
      document: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["ssm:StartSession", "ssm:TerminateSession"],
            resources: [
              `arn:aws:ec2:${region}:${account}:instance/${gpuInstance.instance.ref}`,
              `arn:aws:ssm:${region}:${account}:document/SSM-SessionManagerRunShell`,
            ],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "ssm:DescribeSessions",
              "ssm:GetConnectionStatus",
              "ssm:DescribeInstanceProperties",
              "ec2:DescribeInstances",
            ],
            resources: ["*"],
          }),
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["ssm:TerminateSession", "ssm:ResumeSession"],
            resources: ["arn:aws:ssm:*:*:session/PhotonSession-*"],
          }),
        ],
      }),
    });

    appStreamRole.addManagedPolicy(accessGPUFromAppStreamPolicy);

    staging_bucket.grantRead(appStreamRole);

    const appstreamConfig = this.node.tryGetContext("appStreamConfig");

    const appstream = new CustomAppStream(this, "appstream", {
      vpcId: vpc.vpcId,
      stagingBucketARN: staging_bucket.s3_bucket.bucketArn,
      listAppStreamSubnets: appstream_subnet_ids,
      region: region,
      imageName: appStreamImageName,
      appStreamRole: appStreamRole,
      userSettings: appstreamConfig.userSettings,
    });

    vpcEndpointSG.securityGroupIngress = [
      {
        sourceSecurityGroupId: appstream.fleetSecurityGroup.ref,
        ipProtocol: "tcp",
        fromPort: 443,
        toPort: 443,
      },
      {
        sourceSecurityGroupId: gpuInstance.gpu_sg.ref,
        ipProtocol: "tcp",
        fromPort: 443,
        toPort: 443,
      }
    ];

    /** SSO URL generator */
    const userPoolConfig = this.node.tryGetContext("userpoolConfig");

    const appstream_url_generator = new AppStreamURLGenerator(this, "asug", {
      logs_bucket: logs_bucket.s3_bucket,
      region: region,
      account: account,
      appstream_stack: appstream.stackName,
      appstream_fleet: appstream.fleetName,
      userPoolDomain: userPoolConfig.domainname,
      spaCustomURL: spaCustomURL,
      spaCustomCertificate: spaCustomCertificate,
    });

    /** Adding bucket policy to grant permissions to the logging service principal to write logs to target bucket */

    let logs_s3_bucket_policy = new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [
        logs_bucket.s3_bucket.bucketArn +
          "/" +
          appstream_url_generator.static_content_bucket.bucketName +
          "*",
        logs_bucket.s3_bucket.bucketArn +
          "/" +
          staging_bucket.s3_bucket.bucketName +
          "*"
      ],
      principals: [new iam.ServicePrincipal("logging.s3.amazonaws.com")],
      effect: Effect.ALLOW,
      conditions: {
        StringNotEquals: {
          "aws:SourceAccount": [Stack.of(this).account],
        },
        ArnLike: {
          "aws:SourceARN": [
            appstream_url_generator.static_content_bucket.bucketArn,
            staging_bucket.s3_bucket.bucketArn
          ],
        },
      },
    });

    logs_bucket.s3_bucket.addToResourcePolicy(logs_s3_bucket_policy);

    /** Restricting access to S3 buckets only through HTTPS */

    appstream_url_generator.static_content_bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [
          appstream_url_generator.static_content_bucket.bucketArn,
          appstream_url_generator.static_content_bucket.bucketArn + "/*"
        ],
        principals: [new iam.StarPrincipal()],
        effect: Effect.DENY,
        conditions: {
          Bool: {
            "aws:SecureTransport": false
          }
        },
      })
    );

    staging_bucket.s3_bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [
          staging_bucket.s3_bucket.bucketArn,
          staging_bucket.s3_bucket.bucketArn + "/*"
        ],
        principals: [new iam.StarPrincipal()],
        effect: Effect.DENY,
        conditions: {
          Bool: {
            "aws:SecureTransport": false
          }
        },
      })
    );

    logs_bucket.s3_bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:*"],
        resources: [
          logs_bucket.s3_bucket.bucketArn,
          logs_bucket.s3_bucket.bucketArn + "/*"
        ],
        principals: [new iam.StarPrincipal()],
        effect: Effect.DENY,
        conditions: {
          Bool: {
            "aws:SecureTransport": false
          }
        },
      })
    );

    /** Outputs */
    
    const requiredOutputs = [
      {key: "gpu instance id", value: gpuInstance.instance.ref},
      {key: "apiEndpoint", value: appstream_url_generator.apiEndpoint},
      {key: "cognitoDomain", value: appstream_url_generator.cognitoDomain},
      {key: "cloudfrontFQDN", value: appstream_url_generator.cloudfrontFQDN},
      {key: "stagingBucket", value: staging_bucket.s3_bucket.bucketName},
      {key: "userPoolClientId", value: appstream_url_generator.userPoolClientId},
      {key: "userPoolId", value: appstream_url_generator.userPoolId},
    ]

    requiredOutputs.forEach( (output) => {
      new CfnOutput(this, `output${output.key}`, { value: output.value });
    })

    /** CFN_NAG EXCEPTIONS */

    const flowLogRoles = [
      "/SecureDemoEnvironmentStack/secure-demo-environment-vpc/VPCFlowLogRole/Resource",
      "/SecureDemoEnvironmentStack/network-firewall/ANFW/LambdaPolicyFirewall/Resource",
      "/SecureDemoEnvironmentStack/asug/sso_url_generation/LambdaPolicySSOURL/Resource",
    ];

    const logBuckets = [
      "/SecureDemoEnvironmentStack/logs_s3_bucket/logs_s3_bucket/Resource"
    ];

    const apiGwLogRoles = [
      "/SecureDemoEnvironmentStack/asug/sso_url_generation/APIGWLogRole/Resource",
    ];

    const wildCardPolicies = [
      "/SecureDemoEnvironmentStack/appstreamrole/DefaultPolicy/Resource",
    ];

    const exceptionsForManagedIAMPolicies = [
      "/SecureDemoEnvironmentStack/gpuRole/Resource",
      "/SecureDemoEnvironmentStack/appstreamrole/Resource"
    ];

    const falsePositivesWildcard = [
      "/SecureDemoEnvironmentStack/gpuRole/DefaultPolicy/Resource",
      "/SecureDemoEnvironmentStack/as2gpu/Resource",
      
    ];

    /** Uncomment on step 3, when deploying the React App
    
    const cdkHelpers = [
      "/SecureDemoEnvironmentStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/Resource",
      "/SecureDemoEnvironmentStack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C/ServiceRole/DefaultPolicy/Resource",
    ];

    */

    const suppressionSpecs = [
      {
        suppression: generateSuppressionForFlowLogsRole,
        resources: flowLogRoles,
      },
      { suppression: generateSuppressionForLogBucket, resources: logBuckets },
      { suppression: generateSuppresionForAPIGWLogs, resources: apiGwLogRoles },
      {
        suppression: generateSupressionForLogPolicies,
        resources: wildCardPolicies,
      },
      {
        suppression: generateSuppessionForAWSManagedPolicies,
        resources: exceptionsForManagedIAMPolicies,
      },
      {
        suppression: generateSuppressionForFalsePositiveWildcards,
        resources: falsePositivesWildcard,
      },
      
      /** Uncomment on step 3, when deploying the React App
      
      { suppression: generateSuppressionForCDKHelpers, resources: cdkHelpers }
      
      */
    ];

    suppressionSpecs.forEach((suppressionSpec) => {
      suppressionSpec.resources.forEach((element) => {
        suppressionSpec.suppression(this, element);
      });
    });
  }
}

const makeSuppressionCreator = (suppressions: NagPackSuppression[]) => {
  const suppressionGenerator = (stack: Stack, resource: string) => {
    generateSuppression(stack, resource, suppressions);
  };
  return suppressionGenerator;
};

const generateSuppressionForLogBucket = makeSuppressionCreator([
  {
    id: "AwsSolutions-S1",
    reason: "This is the log bucket for a bucket. Who logs the logger?",
  },
]);
const generateSuppressionForFlowLogsRole = makeSuppressionCreator([
  {
    id: "AwsSolutions-IAM5",
    reason:
      "Only creates Flowlogs as per https://docs.aws.amazon.com/vpc/latest/userguide/flow-logs-cwl.html",
  },
]);
const generateSuppresionForAPIGWLogs = makeSuppressionCreator([
  {
    id: "AwsSolutions-IAM5",
    reason: "KMS limited by condition to cloudwatch logs only",
  },
]);

const generateSupressionForLogPolicies = makeSuppressionCreator([
  { id: "AwsSolutions-IAM5", reason: "Log stream is not known at creation" },
]);
const generateSuppessionForAWSManagedPolicies = makeSuppressionCreator([
  {
    id: "AwsSolutions-IAM4",
    reason: "False positive this is a policy document created from JSON",
  },
]);

const generateSuppressionForFalsePositiveWildcards = makeSuppressionCreator([
  { id: "AwsSolutions-IAM5", reason: "False positive" },
]);

const generateSuppressionForCDKHelpers = makeSuppressionCreator([
  { id: "AwsSolutions-IAM5", reason: "CDK managed helper" },
  { id: "AwsSolutions-IAM4", reason: "CDK managed helper" },
]);

const generateSuppression = (
  stack: Stack,
  resource: string,
  suppressionList: NagPackSuppression[]
) => {
  NagSuppressions.addResourceSuppressionsByPath(
    stack,
    resource,
    suppressionList
  );
};
