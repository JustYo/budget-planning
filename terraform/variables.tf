variable "config_path" {
  description = "Path to kubeconfig used by providers and remote state"
  type        = string
  default     = "~/.kube/config-microk8s"
}
