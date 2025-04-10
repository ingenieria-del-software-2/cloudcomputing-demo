# Output: EC2 instance ID
output "instance_id" {
  value = aws_instance.docker_instance.id
}

# Output: EC2 instance public IP
output "public_ip" {
  value = aws_instance.docker_instance.public_ip
}

# Output: EC2 instance public DNS
output "public_dns" {
  value = aws_instance.docker_instance.public_dns
}

output "ecr_repository_url" {
  value = aws_ecr_repository.microservice_repo.repository_url
}
