import { input, select } from "@inquirer/prompts";
import { aws } from "../utils/aws.js";

export const deleteLambda = async () => {
    const reqLambdas = await aws(`aws lambda list-functions --output json`);
    const listLambdas = JSON.parse(reqLambdas).Functions;
    
    if (listLambdas.length === 0) {
        console.log("No Lambda functions found in your AWS account.");
        return;
    }
    
    const selectedLambda = await select({
        message: "Select a Lambda function to delete",
        choices: listLambdas.map((lambda) => ({
        name: lambda.FunctionName,
        value: lambda.FunctionName,
        })),
    });
    
    const confirmDelete = await input({
        message: "Enter 'confirm' to delete:",
        validate: (input) => {
        if (input !== "confirm") {
            return "You must type 'confirm' to proceed with deletion.";
        }
        return true;
        },
    });
    
    if (confirmDelete === "confirm") {
        await aws(`aws lambda delete-function --function-name ${selectedLambda}`);
        console.log(`Lambda function deleted: ${selectedLambda}`);
    } else {
        console.log("Deletion cancelled.");
    }
}