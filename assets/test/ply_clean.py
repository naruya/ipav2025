import numpy as np
from plyfile import PlyData, PlyElement


def create_distance_filtered_ply(original_ply_path, output_ply_path, max_distance=10.0):
    plydata = PlyData.read(original_ply_path)
    vertex_data = plydata['vertex'].data
    
    positions = np.vstack([
        vertex_data['x'],
        vertex_data['y'],
        vertex_data['z']
    ]).T
    
    distances = np.sqrt(np.sum(positions**2, axis=1))

    indices = np.argsort(distances)
    distances2 = distances[indices]
    print(distances2[::10000])

    
    selected_indices = np.where(distances <= max_distance)[0]
    
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
    
    print(f"Original vertex count: {len(vertex_data)}")
    print(f"Filtered vertex count: {len(subset_vertex_data)}")
    print(f"Removed {len(vertex_data) - len(subset_vertex_data)} vertices")


if __name__ == "__main__":
    create_distance_filtered_ply(
        original_ply_path="kondo_before.ply",
        output_ply_path="kondo_before_clean.ply",
        max_distance=1.5
    )
