# Crear usuario IAM para CI/CD Pipeline
resource "aws_iam_user" "pipeline_user" {
  name = "pipeline-user"
}

# Asignar al usuario IAM permisos para gestionar completamente Amazon ECR
resource "aws_iam_user_policy_attachment" "pipeline_user_ecr_policy" {
  user       = aws_iam_user.pipeline_user.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser"
}

# Crear access key para el usuario pipeline (para GitHub Actions)
resource "aws_iam_access_key" "pipeline_user_key" {
  user = aws_iam_user.pipeline_user.name
}

# Mostrar las credenciales del access key generadas (¡Manejar con precaución!)
output "pipeline_user_access_key_id" {
  value       = aws_iam_access_key.pipeline_user_key.id
  sensitive = true
  description = "Access Key ID para el usuario pipeline-user"
}

output "pipeline_user_secret_access_key" {
  value       = aws_iam_access_key.pipeline_user_key.secret
  sensitive = true
  description = "Secret Access Key para el usuario pipeline-user"
}
