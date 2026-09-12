import * as THREE from "three";
import type { VisualSecondaryDynamic } from "./visualsScene";

export type SecondaryConstraint = { a:number; b:number; rest:number; role:"structural"|"bend" };
export type SecondaryTopology = {
	restLocal: THREE.Vector3[];
	positions: THREE.Vector3[];
	previous: THREE.Vector3[];
	pinned: number[];
	constraints: SecondaryConstraint[];
	triangles: number[];
	uvs: number[];
	rows: number;
	columns: number;
	panels: number;
};

function safeDirection(item: VisualSecondaryDynamic) {
	const direction=new THREE.Vector3(item.restDirectionX,item.restDirectionY,item.restDirectionZ);
	if(direction.lengthSq()<1e-6)direction.set(0,-1,0);
	return direction.normalize();
}

function addConstraint(list:SecondaryConstraint[],a:number,b:number,positions:THREE.Vector3[],role:"structural"|"bend"="structural"){
	if(a===b)return;
	list.push({a,b,rest:positions[a].distanceTo(positions[b]),role});
}

function makeStrand(item:VisualSecondaryDynamic):SecondaryTopology{
	const segments=Math.max(1,Math.round(item.segments));
	const direction=safeDirection(item);
	const positions:Array<THREE.Vector3>=[];
	for(let i=0;i<=segments;i++)positions.push(direction.clone().multiplyScalar(item.length*i/segments));
	const constraints:SecondaryConstraint[]=[];
	for(let i=0;i<segments;i++)addConstraint(constraints,i,i+1,positions,"structural");
	for(let i=0;i<segments-1;i++)addConstraint(constraints,i,i+2,positions,"bend");
	return {restLocal:positions.map(v=>v.clone()),positions,previous:positions.map(v=>v.clone()),pinned:[0],constraints,triangles:[],uvs:[],rows:segments+1,columns:1,panels:1};
}

function makeSheet(item:VisualSecondaryDynamic,wingPanels=false):SecondaryTopology{
	const rows=Math.max(2,Math.round(item.segments)+1);
	const columns=Math.max(2,Math.round(item.columns)+1);
	const panels=wingPanels&&item.mirror?2:1;
	const positions:THREE.Vector3[]=[];
	const pinned:number[]=[];
	const triangles:number[]=[];
	const uvs:number[]=[];
	const constraints:SecondaryConstraint[]=[];
	const direction=safeDirection(item);
	const sideAxis=new THREE.Vector3(1,0,0);
	if(Math.abs(direction.dot(sideAxis))>.92)sideAxis.set(0,0,1);
	const across=new THREE.Vector3().crossVectors(direction,sideAxis).cross(direction).normalize();
	for(let panel=0;panel<panels;panel++){
		const side=panels===2?(panel===0?-1:1):1;
		const base=positions.length;
		for(let r=0;r<rows;r++){
			const vr=r/(rows-1);
			for(let c=0;c<columns;c++){
				const uc=c/(columns-1);
				let lateral=(uc-.5)*item.width;
				if(wingPanels){
					// Wings root at the torso and fan outward into a tapered membrane.
					lateral=side*uc*(item.width*.5);
				}
				const point=direction.clone().multiplyScalar(item.length*vr).addScaledVector(across,lateral);
				if(wingPanels)point.y+=Math.sin(uc*Math.PI)*item.width*.06*(1-vr);
				positions.push(point);
				uvs.push(panels===2?(panel*.5+uc*.5):uc,1-vr);
				if((!wingPanels&&r===0)||(wingPanels&&c===0))pinned.push(base+r*columns+c);
			}
		}
		for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
			const i=base+r*columns+c;
			if(c+1<columns)addConstraint(constraints,i,i+1,positions,"structural");
			if(r+1<rows)addConstraint(constraints,i,i+columns,positions,"structural");
			if(c+1<columns&&r+1<rows){
				addConstraint(constraints,i,i+columns+1,positions,"structural");
				addConstraint(constraints,i+1,i+columns,positions,"structural");
				triangles.push(i,i+columns,i+1,i+1,i+columns,i+columns+1);
			}
			if(c+2<columns)addConstraint(constraints,i,i+2,positions,"bend");
			if(r+2<rows)addConstraint(constraints,i,i+columns*2,positions,"bend");
		}
	}
	return {restLocal:positions.map(v=>v.clone()),positions,previous:positions.map(v=>v.clone()),pinned,constraints,triangles,uvs,rows,columns,panels};
}

export function buildSecondaryTopology(item:VisualSecondaryDynamic):SecondaryTopology{
	if(item.kind==="cloth"||item.kind==="cape")return makeSheet(item,false);
	if(item.kind==="wings")return makeSheet(item,true);
	return makeStrand(item);
}

export function resetSecondaryTopology(topology:SecondaryTopology, matrix:THREE.Matrix4){
	for(let i=0;i<topology.positions.length;i++){
		const p=topology.restLocal[i].clone().applyMatrix4(matrix);
		topology.previous[i].copy(p);
		topology.positions[i].copy(p);
	}
}

export function secondaryTopologySignature(item:VisualSecondaryDynamic){
	return [item.kind,item.segments,item.columns,item.length,item.width,item.radius,item.restDirectionX,item.restDirectionY,item.restDirectionZ,item.mirror].join("|");
}

export function isSecondarySheet(item:VisualSecondaryDynamic){
	return item.kind==="cloth"||item.kind==="cape"||item.kind==="wings";
}
