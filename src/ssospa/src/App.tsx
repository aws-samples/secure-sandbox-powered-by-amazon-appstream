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

import React, { useEffect } from "react";
//import logo from "./logo.svg";
import "./App.css";
import { Amplify, Auth, Hub, Logger } from "aws-amplify";
import "@aws-amplify/ui-react/styles.css";
import '@fontsource/inter/variable.css';
import {
  Authenticator,
  Button,
  ColorMode,
  createTheme,
  defaultTheme,
  Flex,
  withAuthenticator,
} from "@aws-amplify/ui-react";
import { AmplifyProvider } from "@aws-amplify/ui-react";
import { View } from "@aws-amplify/ui-react";
import { Text } from "@aws-amplify/ui-react";
import { Heading } from "@aws-amplify/ui-react";
import { Grid } from "@aws-amplify/ui-react";
import { Link } from '@aws-amplify/ui-react';
import axios from "axios";
//import { theme } from "./theme";

const userPoolId = process.env.REACT_APP_USER_POOL_ID;
const webClientId = process.env.REACT_APP_WEB_CLIENT_ID;
const userPoolDomain = process.env.REACT_APP_USER_POOL_DOMAIN;
const apiEndpoint = `${process.env.REACT_APP_API_ENDPOINT}/sso_url_lambda`;

Amplify.Logger.LOG_LEVEL = "DEBUG";
console.log(`userPoolId ${userPoolId} webClientId ${webClientId}`);

export const isdev = process.env.NODE_ENV == "development";

const home = window.location.origin;

Auth.configure({
  userPoolId: userPoolId,
  userPoolWebClientId: webClientId,
  mandatorySignIn: true,
  oauth: {
    domain: `${userPoolDomain}`,
    scope: [
      "phone",
      "email",
      "profile",
      "openid",
      "aws.cognito.signin.user.admin",
    ],
    redirectSignIn: `${home}`,
    redirectSignOut: `${home}`,
    responseType: "code",
  },
});

const theme2 = createTheme({
  name: "dark-mode-theme",
  overrides: [
    {
      colorMode: "dark",
      tokens: {
        colors: {
          neutral: {
            // flipping the neutral palette
            10: defaultTheme.tokens.colors.neutral[100],
            20: defaultTheme.tokens.colors.neutral[90],
            40: defaultTheme.tokens.colors.neutral[80],
            80: defaultTheme.tokens.colors.neutral[40],
            90: defaultTheme.tokens.colors.neutral[20],
            100: defaultTheme.tokens.colors.neutral[10],
          },
          black: { value: "#fff" },
          white: { value: "#000" },
        },
      },
    },
  ],
});

function App() {
  const [url, setURL] = React.useState(undefined);
  const [colorMode, setColorMode] = React.useState<ColorMode>("light");
  const [isLoading, setLoading] = React.useState(false);
  const [userEmail, setUserEmail] = React.useState(undefined);

  React.useEffect( () => {
    const fetchUserInfo = async () => {
      const userInfo = await Auth.currentAuthenticatedUser();
      const email = userInfo.attributes.email;
      //debugger;
      setUserEmail(email);
    }

    fetchUserInfo()
  },[])

  const generateURL = async (user: any) => {
    //const user = await Amplify.Auth.currentAuthenticatedUser();
    //const creds = await Amplify.Auth.currentCredentials();
    const token = user.signInUserSession.idToken.jwtToken;
    const request = axios.get(apiEndpoint!, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    setLoading(true)
    const resp = await request;
    setURL(resp.data.Message);
    setLoading(false);
  };

  const urlJSXT = url ? <Link href={url} isExternal={true}>Click to access environment</Link> : <Text variation="warning">No URL generated</Text>;
  const urlJSX = <p>{urlJSXT}</p>;
  const whoAmI = userEmail ? userEmail : "";

  return (
    <AmplifyProvider theme={theme2} colorMode={colorMode}>
      <Authenticator>
        {({ signOut, user }) => (
          <Flex
            direction="column"
            justifyContent="flex-start"
            alignItems="stretch"
            alignContent="flex-start"
            wrap="nowrap"
            gap="1rem"
          >
            <View>
              <Heading>Welcome {whoAmI}</Heading>
            </View>
            <View>
              {urlJSX}
              <Button
              isLoading={isLoading}
                variation="primary"
                loadingText="loading"
                onClick={() => generateURL(user)}
                ariaLabel=""
              >
                Access dev environment
              </Button>
              <Button variation="primary" onClick={signOut}>
                Sign out
              </Button>
            </View>
          </Flex>
        )}
      </Authenticator>
    </AmplifyProvider>
  );
}

const ThemedApp = <App />;

export default App;
