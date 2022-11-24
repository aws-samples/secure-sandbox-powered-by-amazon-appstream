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


export interface RouteConfigProps {
    readonly routeTablesIds: string [];
    readonly routeTablesNames: string [];
    readonly internetGatewayId: string;
    readonly natGatewaysIds: string [];
    readonly nfw_endpointsIds: string [];
    readonly nfw_subnets_cidr_blocks: string [];
    readonly list_of_azs: string [];

}

export class CustomRouteConfig extends Construct {

    constructor(scope: Construct, id: string, props: RouteConfigProps) {
        super(scope, id);

        for(let i=0; i<props.routeTablesNames.length;i++){
            if(props.routeTablesNames[i] == ("firewallRouteTable")){

                new ec2.CfnRoute(this, props.routeTablesNames[i], {
                    routeTableId: props.routeTablesIds[i],
                    destinationCidrBlock: '0.0.0.0/0',
                    gatewayId: props.internetGatewayId,
                  });
            } else if (props.routeTablesNames[i].startsWith("natRouteTable")){

                new ec2.CfnRoute(this, props.routeTablesNames[i], {
                    routeTableId: props.routeTablesIds[i],
                    destinationCidrBlock: '0.0.0.0/0',
                    vpcEndpointId: props.nfw_endpointsIds[i-1]
                  });
            } else if(props.routeTablesNames[i].startsWith("privateRouteTable")) {
                
                new ec2.CfnRoute(this, props.routeTablesNames[i], {
                    routeTableId: props.routeTablesIds[i],
                    destinationCidrBlock: '0.0.0.0/0',
                    natGatewayId: props.natGatewaysIds[i-(props.list_of_azs.length+1)]
                  });
            } else if(props.routeTablesNames[i] == "internetGatewayRouteTable") {

                props.nfw_endpointsIds.forEach((nfw_endpoint,endpointIndex) => {
                    new ec2.CfnRoute(this, props.routeTablesNames[i]+(endpointIndex+1), {
                        routeTableId: props.routeTablesIds[i],
                        destinationCidrBlock: props.nfw_subnets_cidr_blocks[endpointIndex],
                        vpcEndpointId: nfw_endpoint
                    });
                });

                new ec2.CfnGatewayRouteTableAssociation(this, 'GatewayRouteTableAssociation', {
                    gatewayId: props.internetGatewayId,
                    routeTableId: props.routeTablesIds[i],
                  });
                  
            }
        }
    }
}