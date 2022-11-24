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
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from "aws-cdk-lib/aws-kms";
import { RemovalPolicy } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import { CfnSecurityGroup } from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import {readFileSync} from 'fs';
export interface GPUProps {
    readonly vpc_id: string;
    readonly gpu_subnets: string[];
    readonly gpuInstanceProfile: string;
    readonly gpuContext: any;
}

export class GPUInstance extends Construct {
    public readonly gpu_sg: CfnSecurityGroup;
    public readonly instance: ec2.CfnInstance;

    constructor(scope: Construct, id: string, props: GPUProps) {
        super(scope, id);

    const gpu_sg = new ec2.CfnSecurityGroup(this, "GPU_SG", {
        groupDescription: "GPU_SG",
        groupName: "GPU_SG",
        securityGroupEgress: [
          {
            ipProtocol: "-1",
            cidrIp: props.gpuContext.gpuInstanceSG.egressAllowedCIDR,
            description: "Allow outbound connection",
          },
        ],
        securityGroupIngress: [
          {
            ipProtocol: "tcp",
            sourcePrefixListId: props.gpuContext.gpuInstanceSG.sourceCIDR,
            description: "Allow SSH to GPU host",
            fromPort: 22,
            toPort: 22,
          },
        ],
        tags: [
          {
            key: "Name",
            value: "GPU_SG",
          },
        ],
        vpcId: props.vpc_id,
      });

    const gpu_kms_key = new kms.Key(this, "gpy_key", {
        enableKeyRotation: true,
        removalPolicy: RemovalPolicy.DESTROY,
      });
  
    /**Limited to only 1 GPU instance. Should be creating one instance in each az. Uncomment the block below
     * to deploy the GPU intance on every subnet
    */

    const gpuInstance = new ec2.CfnInstance(this, 'GPUInstance', {
        blockDeviceMappings: [
          {
            deviceName: "/dev/xvda",
            ebs: {
                deleteOnTermination: props.gpuContext.blockDeviceMappings[0].ebs.deleteOnTermination,
                encrypted: true,
                kmsKeyId: gpu_kms_key.keyId,
                volumeSize: props.gpuContext.blockDeviceMappings[0].ebs.volumeSize,
                volumeType: props.gpuContext.blockDeviceMappings[0].ebs.volumeType,
            },
        },
          {
            deviceName: props.gpuContext.blockDeviceMappings[0].deviceName,

            ebs: {
                deleteOnTermination: props.gpuContext.blockDeviceMappings[0].ebs.deleteOnTermination,
                encrypted: true,
                kmsKeyId: gpu_kms_key.keyId,
                volumeSize: props.gpuContext.blockDeviceMappings[0].ebs.volumeSize,
                volumeType: props.gpuContext.blockDeviceMappings[0].ebs.volumeType,
            },
        }],

        imageId: props.gpuContext.gpu_image_id,
        instanceType: props.gpuContext.instanceType,
        iamInstanceProfile: props.gpuInstanceProfile,
        monitoring: props.gpuContext.monitoring,
        securityGroupIds: [gpu_sg.ref],
        subnetId: props.gpu_subnets[0], 
        tags: [{
            key: 'Name',
            value: 'GPUInstance',
        }],
        disableApiTermination: true,
    });

    this.gpu_sg = gpu_sg;
    this.instance = gpuInstance;

    /** UNCOMMENT TO LOOP THROUGH ALL THE SUBNETS */
    /*
    props.gpu_subnets.forEach(subnet =>{
        const gpuInstance = new ec2.CfnInstance(this, 'GPUInstance', {
            blockDeviceMappings: [{
                deviceName: gpuContext.blockDeviceMappings[0].deviceName,
    
                ebs: {
                    deleteOnTermination: gpuContext.blockDeviceMappings[0].ebs.deleteOnTermination,
                    encrypted: true,
                    kmsKeyId: gpu_kms_key.keyId,
                    volumeSize: gpuContext.blockDeviceMappings[0].ebs.volumeSize,
                    volumeType: gpuContext.blockDeviceMappings[0].ebs.volumeType,
                },
            }],
    
            imageId: gpuImageId.imageId,
            instanceType: gpuContext.instanceType,
            keyName: gpuContext.keyName, //should be existing on the account
            monitoring: gpuContext.monitoring,
            securityGroupIds: [gpu_sg.ref],
            subnetId: subnet, 
            tags: [{
                key: 'Name',
                value: 'GPUInstance',
            }],
            disableApiTermination: true,
        });
    })
*/


    }
}