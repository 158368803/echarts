/*
* Licensed to the Apache Software Foundation (ASF) under one
* or more contributor license agreements.  See the NOTICE file
* distributed with this work for additional information
* regarding copyright ownership.  The ASF licenses this file
* to you under the Apache License, Version 2.0 (the
* "License"); you may not use this file except in compliance
* with the License.  You may obtain a copy of the License at
*
*   http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing,
* software distributed under the License is distributed on an
* "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
* KIND, either express or implied.  See the License for the
* specific language governing permissions and limitations
* under the License.
*/

/**
 * Simple view coordinate system
 * Mapping given x, y to transformd view x, y
 */

import * as zrUtil from 'zrender/src/core/util';
import * as vector from 'zrender/src/core/vector';
import * as matrix from 'zrender/src/core/matrix';
import BoundingRect from 'zrender/src/core/BoundingRect';
import Transformable from 'zrender/src/core/Transformable';
import { CoordinateSystemMaster, CoordinateSystem } from './CoordinateSystem';
import GlobalModel from '../model/Global';
import { ParsedModelFinder } from '../util/model';

var v2ApplyTransform = vector.applyTransform;

class View extends Transformable implements CoordinateSystemMaster, CoordinateSystem {

    readonly type: string = 'view';

    static dimensions = ['x', 'y'];
    readonly dimensions = ['x', 'y'];

    readonly name: string;

    zoomLimit: {
        max?: number;
        min?: number;
    };

    private _roamTransformable = new Transformable();
    protected _rawTransformable = new Transformable();

    private _center: number[];
    private _zoom: number;
    protected _rect: BoundingRect;
    private _viewRect: BoundingRect;
    private _rawTransform: matrix.MatrixArray;


    constructor(name?: string) {
        super();
        this.name = name;
    }

    // PENDING to getRect
    setBoundingRect(x: number, y: number, width: number, height: number): BoundingRect {
        this._rect = new BoundingRect(x, y, width, height);
        return this._rect;
    }

    /**
     * @return {module:zrender/core/BoundingRect}
     */
    // PENDING to getRect
    getBoundingRect(): BoundingRect {
        return this._rect;
    }

    setViewRect(x: number, y: number, width: number, height: number): void {
        this.transformTo(x, y, width, height);
        this._viewRect = new BoundingRect(x, y, width, height);
    }

    /**
     * Transformed to particular position and size
     */
    transformTo(x: number, y: number, width: number, height: number): void {
        var rect = this.getBoundingRect();
        var rawTransform = this._rawTransformable;

        rawTransform.transform = rect.calculateTransform(
            new BoundingRect(x, y, width, height)
        );

        rawTransform.decomposeTransform();

        this._updateTransform();
    }

    /**
     * Set center of view
     */
    setCenter(centerCoord?: number[]): void {
        if (!centerCoord) {
            return;
        }
        this._center = centerCoord;

        this._updateCenterAndZoom();
    }

    setZoom(zoom: number): void {
        zoom = zoom || 1;

        var zoomLimit = this.zoomLimit;
        if (zoomLimit) {
            if (zoomLimit.max != null) {
                zoom = Math.min(zoomLimit.max, zoom);
            }
            if (zoomLimit.min != null) {
                zoom = Math.max(zoomLimit.min, zoom);
            }
        }
        this._zoom = zoom;

        this._updateCenterAndZoom();
    }

    /**
     * Get default center without roam
     */
    getDefaultCenter(): number[] {
        // Rect before any transform
        var rawRect = this.getBoundingRect();
        var cx = rawRect.x + rawRect.width / 2;
        var cy = rawRect.y + rawRect.height / 2;

        return [cx, cy];
    }

    getCenter(): number[] {
        return this._center || this.getDefaultCenter();
    }

    getZoom(): number {
        return this._zoom || 1;
    }

    getRoamTransform(): matrix.MatrixArray {
        return this._roamTransformable.getLocalTransform();
    }

    /**
     * Remove roam
     */
    private _updateCenterAndZoom(): void {
        // Must update after view transform updated
        var rawTransformMatrix = this._rawTransformable.getLocalTransform();
        var roamTransform = this._roamTransformable;
        var defaultCenter = this.getDefaultCenter();
        var center = this.getCenter();
        var zoom = this.getZoom();

        center = vector.applyTransform([], center, rawTransformMatrix);
        defaultCenter = vector.applyTransform([], defaultCenter, rawTransformMatrix);

        roamTransform.origin = center;
        roamTransform.position = [
            defaultCenter[0] - center[0],
            defaultCenter[1] - center[1]
        ];
        roamTransform.scale = [zoom, zoom];

        this._updateTransform();
    }

    /**
     * Update transform from roam and mapLocation
     */
    protected _updateTransform(): void {
        var roamTransformable = this._roamTransformable;
        var rawTransformable = this._rawTransformable;

        rawTransformable.parent = roamTransformable;
        roamTransformable.updateTransform();
        rawTransformable.updateTransform();

        matrix.copy(this.transform || (this.transform = []), rawTransformable.transform || matrix.create());

        this._rawTransform = rawTransformable.getLocalTransform();

        this.invTransform = this.invTransform || [];
        matrix.invert(this.invTransform, this.transform);

        this.decomposeTransform();
    }

    getTransformInfo(): {
        roamTransform: matrix.MatrixArray,
        rawScale: number[],
        rawPosition: number[]
    } {
        var roamTransform = this._roamTransformable.transform;
        var rawTransformable = this._rawTransformable;
        return {
            roamTransform: roamTransform ? zrUtil.slice(roamTransform) : matrix.create(),
            rawScale: zrUtil.slice(rawTransformable.scale),
            rawPosition: zrUtil.slice(rawTransformable.position)
        };
    }

    getViewRect(): BoundingRect {
        return this._viewRect;
    }

    /**
     * Get view rect after roam transform
     */
    getViewRectAfterRoam(): BoundingRect {
        var rect = this.getBoundingRect().clone();
        rect.applyTransform(this.transform);
        return rect;
    }

    /**
     * Convert a single (lon, lat) data item to (x, y) point.
     */
    dataToPoint(data: number[], noRoam?: boolean, out?: number[]): number[] {
        var transform = noRoam ? this._rawTransform : this.transform;
        out = out || [];
        return transform
            ? v2ApplyTransform(out, data, transform)
            : vector.copy(out, data);
    }

    /**
     * Convert a (x, y) point to (lon, lat) data
     */
    pointToData(point: number[]): number[] {
        var invTransform = this.invTransform;
        return invTransform
            ? v2ApplyTransform([], point, invTransform)
            : [point[0], point[1]];
    }

    convertToPixel(ecModel: GlobalModel, finder: ParsedModelFinder, value: number[]): number[] {
        var coordSys = getCoordSys(finder);
        return coordSys === this ? coordSys.dataToPoint(value) : null;
    }

    convertFromPixel(ecModel: GlobalModel, finder: ParsedModelFinder, pixel: number[]): number[] {
        var coordSys = getCoordSys(finder);
        return coordSys === this ? coordSys.pointToData(pixel) : null;
    }

    /**
     * @implements
     */
    containPoint(point: number[]): boolean {
        return this.getViewRectAfterRoam().contain(point[0], point[1]);
    }

    /**
     * @return {number}
     */
    // getScalarScale() {
    //     // Use determinant square root of transform to mutiply scalar
    //     var m = this.transform;
    //     var det = Math.sqrt(Math.abs(m[0] * m[3] - m[2] * m[1]));
    //     return det;
    // }
}

function getCoordSys(finder: ParsedModelFinder): View {
    var seriesModel = finder.seriesModel;
    return seriesModel ? seriesModel.coordinateSystem as View : null; // e.g., graph.
}

export default View;
