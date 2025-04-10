# Create an ECR repository for the microservice
resource "aws_ecr_repository" "microservice_repo" {
  name = var.microservice_name

  image_scanning_configuration {
    scan_on_push = true
  }

  force_delete = true
}
