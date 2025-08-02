/**
 * AWS Lambda handler for API Gateway HTTP event.
 *
 * @param {import('aws-lambda').APIGatewayProxyEvent} event - The event object containing HTTP request info.
 * @param {import('aws-lambda').Context} context - The Lambda execution context.
 * @returns {Promise<import('aws-lambda').APIGatewayProxyResult>} The HTTP response.
**/

export const handler = async (event) => {
    if(event.httpMethod == 'GET') {
        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Hello from L',
            }),
        };
    }
}