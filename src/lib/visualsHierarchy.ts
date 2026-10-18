import * as THREE from "three";
import type { VisualPrimitiveObject, VisualSceneState } from "./visualsScene";

const MAX_DEPTH = 8;
const matrix = (p: VisualPrimitiveObject) => new THREE.Matrix4().compose(
	new THREE.Vector3(p.positionX, p.positionY, p.positionZ),
	new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotationX, p.rotationY, p.rotationZ)),
	new THREE.Vector3(p.scaleX, p.scaleY, p.scaleZ),
);

export function primitiveWorldMatrix(primitives: VisualPrimitiveObject[], id: string): THREE.Matrix4 | null {
	const byId = new Map(primitives.map(p => [p.id, p]));
	const chain: VisualPrimitiveObject[] = [];
	const seen = new Set<string>();
	let current = byId.get(id);
	while (current) {
		if (seen.has(current.id) || chain.length >= MAX_DEPTH) return null;
		seen.add(current.id);
		chain.unshift(current);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	if (!chain.length) return null;
	return chain.reduce((world, item) => world.multiply(matrix(item)), new THREE.Matrix4());
}

export function canParentPrimitive(scene: VisualSceneState, id: string, parentId: string): boolean {
	const child = scene.primitives.find(p => p.id === id);
	if (!child || child.physics.bodyType !== "static" || parentId === id) return false;
	if (!parentId) return true;
	const parent = scene.primitives.find(p => p.id === parentId);
	if (!parent || parent.physics.bodyType !== "static") return false;
	let current: VisualPrimitiveObject | undefined = parent;
	const seen = new Set<string>();
	let depth = 1;
	while (current) {
		if (current.id === id || seen.has(current.id) || depth++ >= MAX_DEPTH) return false;
		seen.add(current.id);
		current = current.parentId ? scene.primitives.find(p => p.id === current!.parentId) : undefined;
	}
	// Existing descendants also count toward the bounded hierarchy depth.
	const children = new Map<string, string[]>();
	for (const item of scene.primitives) if (item.parentId) children.set(item.parentId, [...(children.get(item.parentId) || []), item.id]);
	const visited = new Set<string>();
	const visit = (node: string, level: number): boolean => {
		if (level > MAX_DEPTH || visited.has(node)) return false;
		visited.add(node);
		return (children.get(node) || []).every(next => visit(next, level + 1));
	};
	return visit(id, depth);
}

/** Return the original scene if the requested affine transform cannot be represented by local TRS. */
export function parentPrimitive(scene: VisualSceneState, id: string, parentId: string): VisualSceneState {
	if (!canParentPrimitive(scene, id, parentId)) return scene;
	const child = scene.primitives.find(p => p.id === id)!;
	if ((child.parentId || "") === parentId) return scene;
	const world = primitiveWorldMatrix(scene.primitives, id);
	const parentWorld = parentId ? primitiveWorldMatrix(scene.primitives, parentId) : new THREE.Matrix4();
	if (!world || !parentWorld) return scene;
	const local = parentWorld.clone().invert().multiply(world);
	const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
	local.decompose(position, rotation, scale);
	if (Math.max(...local.elements.map((value, i) => Math.abs(value - new THREE.Matrix4().compose(position, rotation, scale).elements[i]))) > 1e-5) return scene;
	if ([scale.x, scale.y, scale.z].some(value => value < .001 || value > 100)) return scene;
	const euler = new THREE.Euler().setFromQuaternion(rotation);
	return {...scene, primitives: scene.primitives.map(p => p.id === id ? {...p, parentId,
		positionX: position.x, positionY: position.y, positionZ: position.z,
		rotationX: euler.x, rotationY: euler.y, rotationZ: euler.z,
		scaleX: scale.x, scaleY: scale.y, scaleZ: scale.z} : p)};
}

/** Detach direct children before removing a parent so they keep their world pose. */
export function removePrimitiveParent(scene: VisualSceneState, id: string): VisualSceneState {
	let next = scene;
	for (const child of scene.primitives.filter(p => p.parentId === id)) {
		const detached = parentPrimitive(next, child.id, "");
		if (detached === next) return scene;
		next = detached;
	}
	return next;
}
