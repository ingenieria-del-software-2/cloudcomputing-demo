# Pipeline credentials
output "AWS_ACCESS_KEY_ID" {
  value       = aws_iam_access_key.pipeline_user_key.id
  description = "Access key del usuario IAM `pipeline-user`"
  sensitive   = true
}

output "AWS_SECRET_ACCESS_KEY" {
  value       = aws_iam_access_key.pipeline_user_key.secret
  description = "Secret key del usuario IAM `pipeline-user`"
  sensitive   = true
}

output "AWS_ACCOUNT_ID" {
  value       = data.aws_caller_identity.current.account_id
  description = "ID numérico de tu cuenta AWS (sin espacios ni guiones)"
}

# EC2 connection details
output "EC2_HOST" {
  value       = aws_instance.docker_instance.public_ip
  description = "Dirección IP público de la instancia EC2"
}

# The EC2 SSH key needs to be generated separately and provided as input
output "EC2_SSH_KEY" {
  value       = "La clave privada del Key Pair está en tu sistema local"
  description = "Clave privada del Key Pair utilizada por EC2 (formato texto plano, sin passphrase)"
}

# Output: EC2 instance public DNS
output "EC2_PUBLIC_DNS" {
  value = aws_instance.docker_instance.public_dns
}

output "ECR_REPOSITORY_URL" {
  value = aws_ecr_repository.microservice_repo.repository_url
}
