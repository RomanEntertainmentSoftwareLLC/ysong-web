import * as THREE from "three";

/** Pick only geometry that is currently drawn in the editor scene. */
export function pickVisibleEditorObject(
	raycaster: THREE.Raycaster,
	scene: THREE.Scene,
	roots: Iterable<readonly [string, THREE.Object3D]>,
): string {
	const owners = new Map<THREE.Object3D, string>();
	for (const [id, root] of roots) {
		let ancestor: THREE.Object3D | null = root;
		while (ancestor?.visible && ancestor !== scene) ancestor = ancestor.parent;
		if (ancestor === scene) owners.set(root, id);
	}
	for (const hit of raycaster.intersectObjects([...owners.keys()], true)) {
		let object: THREE.Object3D | null = hit.object;
		let visible = true;
		while (object && object !== scene) {
			if (!object.visible) visible = false;
			if (visible && owners.has(object)) {
				const material = (hit.object as THREE.Mesh).material;
				if (!material || (Array.isArray(material) ? material.some((m) => m.visible) : material.visible))
					return owners.get(object) ?? "";
				break;
			}
			object = object.parent;
		}
	}
	return "";
}
