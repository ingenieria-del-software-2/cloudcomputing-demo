# IAM Role para EC2 (Session Manager + ECR Pull)
resource "aws_iam_role" "ec2_ssm_ecr_role" {
  name = "ec2_ssm_ecr_role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Attach AmazonSSM policy para Session Manager
resource "aws_iam_role_policy_attachment" "ssm_attachment" {
  role       = aws_iam_role.ec2_ssm_ecr_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Attach AmazonEC2ContainerRegistryReadOnly policy para permitir Docker pull desde cualquier ECR
resource "aws_iam_role_policy_attachment" "ecr_readonly_attachment" {
  role       = aws_iam_role.ec2_ssm_ecr_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# Instance Profile para EC2 con los roles asignados
resource "aws_iam_instance_profile" "ec2_instance_profile" {
  name = "ec2_ssm_profile"
  role = aws_iam_role.ec2_ssm_ecr_role.name
}
