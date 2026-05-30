import torch

print(f"CUDA Available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"Device Name: {torch.cuda.get_device_name(0)}")
    print(f"Device Properties: {torch.cuda.get_device_properties(0)}")
else:
    print("No CUDA device found.")
