# `l` Documentation

Welcome to the documentation

## Prerequisites

Before using this tool, ensure you have the following installed:

- [AWS CLI](https://aws.amazon.com/cli/): Required for interacting with AWS services. Follow the [installation guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html) to set it up.

## Usage

```bash
l <command> <subcommand> [<args>]
```

## Global Commands

### `create`

First, create a new project before using another command.

```bash
l create
```

## Commands in Lambda Directory

### Change Directory to Lambda Function Folder

Before running any commands, ensure you are in the directory containing your Lambda function. Use the following command to navigate to the folder:

```bash
cd /path/to/your/lambda/function
```

Replace `/path/to/your/lambda/function` with the actual path to your Lambda function folder.

### `push`

Push local function to AWS Lambda.

```bash
l push
```

### `push config`

Push local configuration to AWS Lambda.

```bash
l push config
```

### `pull`

Pull function from AWS Lambda.

```bash
l pull
```

### `pull config`

Pull configuration from AWS Lambda.

```bash
l pull config
```

Updated on 21:00 WIB
