## Secure sandbox powered by Amazon AppStream 2.0

This sample deploys a secure isolated sandbox with Amazon AppStream 2.0 and AWS Network Firewall. Optionally, you can integrate Amazon EFS with AppStream 2.0 fleets.

### 1 Pre-requisites
1. A deployment environment containing node.js and connectivity to NPM
2. AWS IAM credentials
3. (Optional) An AWS route53 hosted zone
4. An AppStream Image you want to use. Can use default for initial setup or go to (step 6) then come back

### 2 Deployment of the backend and AppStream stacks
1. Build the SSO url generator package `cd src/sso_url && npm run package`
2. Navigate to iac `cd iac`
3. In the `iac` directory, edit `cdk.context.json` values as appropriate. MUST Edits: AWS Account ID, Amazon Cognito Domain Name. You may also want to modify: Region, Availability Zones, CIDR Block of the VPC, Subnets CIDR blocks, Ingress and Egress Allowed CIDR blocks for the GPU instance Security Group, Allowed Domains by Network Firewall, AMI of the GPU instance, and AppStream Image
4. Install the CDK app `npm install`
5. Bootstrap the stack `npx cdk bootstrap`
6. Run the CDK deployment script `npx cdk deploy`

### 3 Configure and deploy the UI
1. Navigate to the app `cd src/ssospa`
2. Install the dependencies `npm install`
3. Rename template.env.prod to .env.prod and modify the variables to match the outputs obtained in Step 2. You can get these outputs from the CloudFormation Stack Outputs in the AWS Console
4. Build the react distributable by `npm run build:prod`
5. Navigate back to iac `cd iac`. Uncomment lines 495-498 and line 524 on the `secure-demo-environment-stack.ts` file.
6. Perform `npx cdk deploy` a second time. This time it will deploy the bundled React APP

### 4 Manual setup
1. Create Cognito users in your user pool
2. Navigate to AppStream in the AWS Console and start the fleet

### 5 Test
1. Navigate to the React application. You can get the URL from the CloudFromation Stack Outputs in the AWS Console
2. Login using the user credentials you created in step 4
3. Click generate link to obtain the link (valid for 60 seconds)
4. Use the link to access AppStream

### 6 Refining the AppStream image
1. You can update the image used by the AppStream fleet by creating a new image (separate instructions) then updating the cdk context imageName to your new image and redeploying using `npx cdk deploy` (Note - the fleet needs to be manually shut down for this to work)

### 7 (Optional) Brand your AppStream stack
1. Go to the AWS AppStream console. Locate your stack and edit branding to taste

### 8 (Optional) Integrate EFS mounts with AppStream 2.0 fleets 
1.  Launch an Amazon Linux 2 Image Builder instance 
2.	Log into the Image Builder and navigate to `/opt/appstream/SessionScripts` directory
3.	In that directory, create a bash script `efs-mount.sh` with the same content as the file in the `efs` directory:
    1. Replace placeholder file system ID and region with values appropriate to the environment
    2. Prefix the mount command with  sudo `sudo nano efs-mount.sh`
    
    ```
    #!/bin/bash
    sudo mkdir /efs
    sudo mount -t nfs4 -o nfsvers=4.1,rsize=1048576,wsize=1048576,hard,timeo=600,retrans=2,noresvport FILE_SYSTEM.efs.REGION.amazonaws.com:/ /efs
    ```

4.	Give run permissions on the script to the AppStream 2.0 instance using `sudo chmod +x efs-mount.sh`
5.	Replace the `config.json` file with the one provided in the `efs` directory. This file specifies that the bash script will run when the AppStream 2.0 session starts

```
{
  "SessionStart": {
    "Executables": [
       {
         "Context": "system",
         "Filename": "/opt/appstream/SessionScripts/efs-mount.sh",
         "Arguments": "",
         "S3LogEnabled": true 
      }
    ],
    "WaitingTime": 30
  } 
}
```

6.	Create another image using `sudo AppStreamImageAssistant create-image --name YOUR_IMAGE_NAME`. Replace the name you want to give to the image in the command 

### 9 Useful things to know and do

**User dirs:**

Files stored in `~/MyFiles/HomeFolder` will be persisted across sessions (in S3)

**Connecting to the s3 buckets from the AppStream instance:**

- Copy from S3 to AppStream `aws s3 cp s3://BUCKET_NAME/path/to/object . --profile appstream_machine_role` .
- Copy from AppStream to s3 `aws s3 cp local/file s3://BUCKET_NAME/path/to/object --profile appstream_machine_role` .
- Connecting to the GPU instance `aws ssm start-session --target i-INSTANCE_ID --profile appstream_machine_role --region REGION`

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This project is licensed under the Apache-2.0 License.

