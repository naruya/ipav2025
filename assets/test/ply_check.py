# plyfileのインストール:
# pip install plyfile

from plyfile import PlyData
import numpy as np
import argparse

# コマンドライン引数のパース
parser = argparse.ArgumentParser()
parser.add_argument('path', type=str)
args = parser.parse_args()

plydata = PlyData.read(args.path)

vertices = np.array([
    (v[0], v[1], v[2])
    # (v[0], v[1], v[2], v[59], v[60], v[61])
    for v in plydata['vertex'].data
])

shape = vertices.shape
print(shape, shape[0]*shape[1])
print(vertices[:8])
print(vertices.max(axis=0), vertices.min(axis=0))


value = 0.8165788054466248

diff = vertices - value
abs_diff = np.abs(diff)
min_index = np.argmin(abs_diff)
index = np.unravel_index(min_index, vertices.shape)

# print(index)
print("target", value)
print("found", vertices[index[0], index[1]])


value = -0.9387695789337158

diff = vertices - value
abs_diff = np.abs(diff)
min_index = np.argmin(abs_diff)
index = np.unravel_index(min_index, vertices.shape)

# print(index)
print("target", value)
print("found", vertices[index[0], index[1]])


# value = np.array([0.121848925948143, 0.18377749621868134, 0.08800936490297318])  # 1, 103661
# value = np.array([0.121848925948143, 0.08800936490297318, 0.18377749621868134])  # 1を逆にしてみた
# value = np.array([0.1223829984664917, 0.18797379732131958, 0.08388936519622803])  # 2, 103660
value = np.array([0.12017040699720383, 0.17500342428684235, 0.08388936519622803])  # 3, 103659
diff = vertices - value
abs_diff = np.abs(diff).sum(axis=1)
min_index = np.argmin(abs_diff)
print(min_index)
print("target:", value)
print("found:", vertices[min_index])