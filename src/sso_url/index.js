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
  
const appstream = require("@aws-sdk/client-appstream"); // ES Modules import
const appstreamClient = new appstream.AppStreamClient();


exports.handler = async (event, context) => {

    //console.debug(JSON.stringify(event));

    const reqContext = event.requestContext;
    const authorizer = reqContext.authorizer;
    const jwt = authorizer.jwt;
    const claims = jwt.claims;
    userId = claims["cognito:username"];
    const email = claims.email;
    const groups_string = claims["cognito:groups"]
    groups = groups_string;
    authPresent = true;
    //console.debug(`userID ${userId} email ${email} groups ${groups}`)

    const sessionIdentifier = email;

    console.log("username: " + sessionIdentifier);

    var params = {
        FleetName: process.env.fleet, /* required */
        StackName: process.env.stack, /* required */
        UserId: sessionIdentifier,
        Validity: 60 //TTL of URL

    };
    console.debug(`About to call c2s ${JSON.stringify(params)}`);
    const response = await createas2streamingurl(params, event.awsRequestId);
    return response;
};

function errorResponse(errorMessage, awsRequestId, callback) { //Function for handling error messaging back to client
    callback(null, {
        statusCode: 500,
        body: JSON.stringify({
            Error: errorMessage,
            Reference: awsRequestId,
        }),
        headers: {
            'Access-Control-Allow-Origin': process.env.origin_domain, //This should be the domain of the website that originated the request, example: amazonaws.com
        },
    });
}

async function createas2streamingurl(params, awsRequestId) {
    console.debug(`Calling createas2streamingurl`)
    const command = new appstream.CreateStreamingURLCommand(params);
    let resp = {
        statusCode: 500,
        body: JSON.stringify({
            Message: url,
            Reference: awsRequestId,
        }),
        headers: {
            'Access-Control-Allow-Origin': process.env.origin_domain, //This should be the domain of the website that originated the request, example: amazonaws.com
        }}
    try {
        const result = await appstreamClient.send(command);
        //console.info(`Success! AS2 Streaming URL created. ${JSON.stringify(result)}`);
        var url = result.StreamingURL;
        resp.statusCode = 200
        resp.body = JSON.stringify({
            Message: url,
            Reference: awsRequestId,
        })
        console.debug(`Returning URL`);
        
    } catch (exception) {
        const error = JSON.stringify(exception.message)
        console.log("error: " + error);
        resp.body = {error: error};
    }
    return resp;
}

local_test = async () => {
    const event = {
        requestContext: {
            authorizer: {
                jwt: {
                        claims: {
                            "cognito:username": "tester",
                            "cognito:groups": ["la", "le"],
                            email: "test@example.com",
                        }
                    }
                }
            }
        }
    await exports.handler(event);
}

local_test().then()