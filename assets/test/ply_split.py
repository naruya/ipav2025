import numpy as np
from plyfile import PlyData, PlyElement

def create_subset_ply(original_ply_path, indices_csv_path, output_ply_path):
    with open(indices_csv_path, 'r') as f:
        line = f.read().strip()
        selected_indices = [int(x) for x in line.split(',') if x.strip()]

    plydata = PlyData.read(original_ply_path)

    vertex_data = plydata['vertex'].data
    subset_vertex_data = vertex_data[selected_indices]
    new_vertex_element = PlyElement.describe(subset_vertex_data, 'vertex')

    other_elements = [elem for elem in plydata.elements if elem.name != 'vertex']

    new_plydata = PlyData(
        [new_vertex_element] + other_elements,
        text=plydata.text
    )

    new_plydata.comments = plydata.comments
    new_plydata.obj_info = plydata.obj_info

    new_plydata.write(output_ply_path)


if __name__ == "__main__":
    create_subset_ply(
        original_ply_path="fukao.ply",
        # indices_csv_path="indices.csv",
        indices_csv_path="indices_18_nosort.csv",
        # output_ply_path="subset.ply"
        output_ply_path="subset_18_nosort.ply"
    )

