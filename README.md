# Instant Skinned Gaussian Avatars

## Web App
https://naruya.github.io/ipav2025/

## Data

We have uploaded some sample data. [Google Drive](https://drive.google.com/drive/folders/1VSxcrAbB2E_qm324mR_H_Bp5Xd3HAuIp?usp=sharing)
- raw scaniverse output (.ply)
- pre-processed avatar data (.gvrm)
- some animation data from [Mixamo](https://www.mixamo.com/#/) (mixamo/*.fbx)



## Usage
![スクリーンショット 2025-02-19 001657](https://github.com/user-attachments/assets/96246691-aafd-47db-949d-fae535b0d86d)

- for preprocessing
  - upload .ply file
- for viewing preprocessed avatar
  - upload .gvrm file

## Run locally

```
$ python -m http.server 8080 &
```

## Support

Supported
- Most recent Windows PC
- iPhone 13 Pro or later
- Meta Quest 3
- Apple Vision Pro

Not Supported
- MacBook Pro (not well tested)
- iPhone 13 or lower
- Android (not well tested)
