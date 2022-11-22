/** Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
  
  Licensed under the Apache License, Version 2.0 (the "License").
  You may not use this file except in compliance with the License.
  You may obtain a copy of the License at
  
      http://www.apache.org/licenses/LICENSE-2.0
  
  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License. */

var aws = require("aws-sdk");
 
exports.handler = function(event, context) {
 
    console.log("REQUEST RECEIVED:\n" + JSON.stringify(event));
    
    // For Delete requests, immediately send a SUCCESS response.
    if (event.RequestType == "Delete") {
        sendResponse(event, context, "SUCCESS");
        return;
    }
 
    var responseStatus = "FAILED";
    var responseData = {};

    var params = {
        Filters: [
          {
            Name: 'service-name',
            Values: [
              "com.amazonaws." + process.env.region + ".appstream.streaming",
            ]
          },
        ],
      };

    var ec2 = new aws.EC2();
    ec2.describeVpcEndpoints(params, function(err, data) {
        if (err){
            responseData = {Error: "DescribeVPCEndpoints call failed"};
            console.log(err, err.stack); // an error occurred
        }else {
            responseStatus = "SUCCESS";
            console.log(data);           // successful response
            responseData["vpcId"] = data["VpcEndpoints"][0]["VpcEndpointId"];
        } 
        sendResponse(event, context, responseStatus, responseData);             
    });
};

// Send response to the pre-signed S3 URL 
function sendResponse(event, context, responseStatus, responseData) {
 
    var responseBody = JSON.stringify({
        Status: responseStatus,
        Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
        PhysicalResourceId: context.logStreamName,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData
    });
 
    console.log("RESPONSE BODY:\n", responseBody);
 
    var https = require("https");
    var url = require("url");
 
    var parsedUrl = url.parse(event.ResponseURL);
    var options = {
        hostname: parsedUrl.hostname,
        port: 443,
        path: parsedUrl.path,
        method: "PUT",
        headers: {
            "content-type": "",
            "content-length": responseBody.length
        }
    };
 
    console.log("SENDING RESPONSE...\n");
 
    var request = https.request(options, function(response) {
        console.log("STATUS: " + response.statusCode);
        console.log("HEADERS: " + JSON.stringify(response.headers));
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
 
    request.on("error", function(error) {
        console.log("sendResponse Error:" + error);
        // Tell AWS Lambda that the function execution is done  
        context.done();
    });
  
    // write data to request body
    request.write(responseBody);
    request.end();
}