# S3 Cats vs Dogs Demo

A Flask web application that demonstrates S3 bucket access with IAM policies, displaying images from cats and dogs buckets.

## Setup

1. **Install dependencies:**
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install flask boto3 botocore python-dotenv
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual AWS credentials and bucket names
   ```

3. **Required environment variables:**
   - `AWS_REGION`: AWS region (default: us-east-1)
   - `AWS_PROFILE`: AWS CLI profile name
   - `CATS_BUCKET`: S3 bucket containing cat images
   - `DOGS_BUCKET`: S3 bucket containing dog images
   - `CATS_PREFIX`: Prefix/folder for cat images (optional)
   - `DOGS_PREFIX`: Prefix/folder for dog images (optional)

4. **Assume IAM Role (Optional):**
   If using CloudFormation-deployed IAM roles instead of direct AWS credentials:

   ```bash
   # First, verify your current identity
   aws sts get-caller-identity --profile iamadmin-general

   # Get the role ARN from CloudFormation stack
   ROLE_ARN=$(aws cloudformation describe-stacks --stack-name animals3 \
     --query "Stacks[0].Outputs[?OutputKey=='AppAccessS3RoleArn'].OutputValue" \
     --output text \
     --profile iamadmin-general)

   # Assume the role and save credentials
   aws sts assume-role \
     --role-arn "$ROLE_ARN" \
     --role-session-name demo \
     --profile iamadmin-general \
     --query 'Credentials' --output json > /tmp/creds.json

   # Export temporary credentials as environment variables
   export AWS_ACCESS_KEY_ID=$(jq -r '.AccessKeyId' /tmp/creds.json)
   export AWS_SECRET_ACCESS_KEY=$(jq -r '.SecretAccessKey' /tmp/creds.json)
   export AWS_SESSION_TOKEN=$(jq -r '.SessionToken' /tmp/creds.json)
   
   # Verify the assumed role
   aws sts get-caller-identity
   ```

   **Important:** When using assumed roles, comment out `AWS_PROFILE` in your `.env` file and use the temporary credentials set as environment variables instead.

5. **Run the application:**
   ```bash
   python3 main.py
   ```

6. **Access the web interface:**
   Open http://localhost:8000 in your browser

## Configuration Files

- `.env.example`: Template with example configuration values
- `.env`: Your local configuration (not committed to git)
- `main.py`: Flask application
- `demo_s3_iam.yaml`: CloudFormation template for IAM policies
- `allow_and_deny.json`: IAM policy allowing access
- `s3_fulladmin.json`: IAM policy with full S3 access

## Demo Images

- `catspics/`: Sample cat images
- `dogpics/`: Sample dog images

Copy these to your S3 buckets or update the prefixes in your .env file to match your bucket structure.
