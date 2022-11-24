#!/usr/bin/env node

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

import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SecureDemoEnvironmentStack } from '../lib/secure-demo-environment-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();

const env = app.node.tryGetContext("env");

const appstreamStack = new SecureDemoEnvironmentStack(app, 'SecureDemoEnvironmentStack', {
  env:env,
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});
//NagSuppressions.addStackSuppressions(stack, [{ id: 'AwsSolutions-IAM5', reason: 'lorem ipsum' }])


Aspects.of(app).add(new AwsSolutionsChecks({verbose: true, logIgnores: true}));


