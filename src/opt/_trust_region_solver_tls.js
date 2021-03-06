'use strict';

/* This file is part of ND4JS.
 *
 * ND4JS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ND4JS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ND4JS. If not, see <http://www.gnu.org/licenses/>.
 */


import {array, asarray, NDArray} from '../nd_array'

import {_giv_rot_qr,
        _giv_rot_rows} from "../la/_giv_rot";
import {FrobeniusNorm} from "../la/norm";
import {  _qr_decomp_inplace} from '../la/qr'
import {_rrqr_decomp_inplace,
        _rrqr_rank} from "../la/rrqr";
import {_triu_solve,
        _triu_t_solve} from "../la/tri";

import {OptimizationNoProgressError} from "./optimization_error";


export function odr_gen( trust_region )
{
  const fit_odr_gen = (x,y, fgg,p0, opt={}) =>
  {
    if( ! (fgg instanceof Function) )
      throw new Error(`${NAME}(x,y, fgg,p0): fgg must be function.`);

    x  =   array('float64', x );
    y  =   array('float64', y );
    p0 = asarray('float64', p0);

    const dx0 = 'dx0' in opt
      ?      array('float64', opt.dx0)
      : x.mapElems('float64', () => 0);

    const NAME = fit_odr_gen.name;

    if(p0.ndim !== 1 ) throw new Error(`${NAME}(x,y, fgg,p0): p0.ndim must be 1.`);
    if( x.ndim !== 1 &&
        x.ndim !== 2 ) throw new Error(`${NAME}(x,y, fgg,p0): x.ndim must be 1 or 2.`);
    if( y.ndim !== 1 &&
        y.ndim !== 2 ) throw new Error(`${NAME}(x,y, fgg,p0): y.ndim must be 1 or 2.`);
    if( x.ndim !== dx0.ndim ) throw new Error(`${NAME}(x,y, fgg,p0, opt): opt.dx0 and x must have same ndim.`);

    const [MX,NX=1] = x.shape,
          [MY,NY=1] = y.shape,
            [NP  ] =p0.shape;

    if( x.ndim == 2 &&
        NX !== dx0.shape[1] ) throw new Error(`${NAME}(x,y, fgg,p0, opt): opt.dx0 and x must have same shape.`);
    if( MX !== dx0.shape[0] ) throw new Error(`${NAME}(x,y, fgg,p0, opt): opt.dx0 and x must have same shape.`);
    if( MX !== MY ) throw new Error(`${NAME}(x,y, fgg,p0, opt): x.shape[0] must equal y.shape[0].`);

    const x_ndim  = x.ndim,
          y_ndim  = y.ndim,
        xi_shape = x.shape.slice(1);
    const  
            dy    = new Float64Array(MX*NY),
            dy_dp = new Float64Array(MX*NY*NP),
            dy_dx = new Float64Array(MX*NY*NX),
      result_dy    = new NDArray(                  y.shape                        , dy    ),
      result_dy_dp = new NDArray( Int32Array.of(...y.shape,NP                    ), dy_dp ),
      result_dy_dx = new NDArray( Int32Array.of(...y.shape,...x.shape.subarray(1)), dy_dx );

    x = x.data;
    y = y.data;

    const fjj = (p,dx) => {
      if( !  p.dtype.startsWith('float') )  throw new Error('Assertion failed.');
      if( ! dx.dtype.startsWith('float') )  throw new Error('Assertion failed.');

      if( p.ndim     !== 1 ) throw new Error('Assertion failed.');
      if( p.shape[0] !== NP) throw new Error('Assertion failed.');

      if(  x_ndim     !== dx.ndim ) throw new Error('Assertion failed.');
      if(  x_ndim     !== 1 &&
          dx.shape[1] !== NX ) throw new Error('Assertion failed.');
      if( dx.shape[0] !== MX ) throw new Error('Assertion failed.');

      const fgg_p = fgg(p);

      dx = dx.data;

      for( let i=0; i < MX; i++ )
      {
        const xi = dx.slice(NX*i, NX*(i+1));

        for( let j=NX; j-- > 0; )
          xi[j] += x[NX*i + j];

        let [
          dyi,
          dyi_dp,
          dyi_dx
        ] = fgg_p( new NDArray(xi_shape, xi) );

        dyi    = asarray('float', dyi   );
        dyi_dp = asarray('float', dyi_dp);
        dyi_dx = asarray('float', dyi_dx);

        if( dyi   .ndim !== y_ndim - 1 ) throw new Error('Assertion failed.');
        if( dyi_dp.ndim !== y_ndim     ) throw new Error('Assertion failed.');
        if( dyi_dx.ndim !== y_ndim - 2 +
                            x_ndim     ) throw new Error('Assertion failed.');

        if( y_ndim !== 1 )
        {
          if( dyi   .shape[0] !== NY ) throw new Error('Assertion failed.');
          if( dyi_dp.shape[0] !== NY ) throw new Error('Assertion failed.');
          if( dyi_dx.shape[0] !== NY ) throw new Error('Assertion failed.');
        }

        if(              x_ndim    !== 1 &&
            dyi_dx.shape[y_ndim-1] !== NX ) throw new Error('Assertion failed.');
        if( dyi_dp.shape[y_ndim-1] !== NP ) throw new Error('Assertion failed.');

        dyi    = dyi   .data;
        dyi_dp = dyi_dp.data;
        dyi_dx = dyi_dx.data;

        for( let j=   NY; j-- > 0; ) dy   [   NY*i + j] = dyi   [j] - y[NY*i + j];
        for( let j=NP*NY; j-- > 0; ) dy_dp[NP*NY*i + j] = dyi_dp[j];
        for( let j=NX*NY; j-- > 0; ) dy_dx[NX*NY*i + j] = dyi_dx[j];
      }

      // we know that the TrustRegionSolverTLS performs protection copies so we can reuse memory
      return [
        result_dy,
        result_dy_dp,
        result_dy_dx
      ];
    };

    return trust_region( new TrustRegionSolverTLS(fjj, p0,dx0), opt );
  }

  Object.defineProperty(fit_odr_gen, 'name', {value: `odr${trust_region.name}_gen`});
  return                fit_odr_gen;
}


const REPORT_STATE_READY    = 1,
      REPORT_STATE_NA       = 2,
      REPORT_STATE_CONSIDER = 3;


export class TrustRegionSolverTLS
{
  constructor( fgg, p0, dx0 )
  {
    if( ! (fgg instanceof Function) )
      throw new Error('Assertion failed.');

     p0 = array('float64',  p0);
    dx0 = array('float64', dx0);

    if( p0.ndim !== 1 ) throw new Error('Assertion failed.');
    if(dx0.ndim !== 1 &&
       dx0.ndim !== 2 ) throw new Error('Assertion failed.');

    const [MX,NX=1] = dx0.shape,
             [NP  ] =  p0.shape;

    let [dy, dy_dp, dy_dx] = fgg(
      new NDArray(  p0.shape, p0.data.slice() ),
      new NDArray( dx0.shape,dx0.data.slice() )
    );

    dy    = array('float64', dy);
    dy_dp = array('float64', dy_dp);
    dy_dx = array('float64', dy_dx);

    if( dy.ndim !== 1 &&
        dy.ndim !== 2 ) throw new Error('Assertion failed.');
    if( dy_dp.ndim !== dy.ndim+1 ) throw new Error('Assertion failed.');
    if( dy_dx.ndim !== dy.ndim +
                      dx0.ndim-1 ) throw new Error('Assertion failed.');

    const [MY,NY=1] = dy.shape;

    if( MX !== MY ) throw new Error('Assertion failed.');
    if( dy_dp.shape[0] !== MX ) throw new Error('Assertion failed.');
    if( dy_dx.shape[0] !== MX ) throw new Error('Assertion failed.');
    if( dy.ndim === 2 )
    {
      if( dy_dp.shape[1] !== NY ) throw new Error('Assertion failed.');
      if( dy_dx.shape[1] !== NY ) throw new Error('Assertion failed.');
    }
    if( dx0.ndim === 2 && dy_dx.shape[dy.ndim] !== NX ) throw new Error('Assertion failed.');
    if(                   dy_dp.shape[dy.ndim] !== NP ) throw new Error('Assertion failed.');

    const M = MX*NX + MX*NY,
          N = MX*NX + NP,
          L = Math.min(NX,NY),
          K = Math.min(MX*NX + NP+1, MX*NY), // <- +1 as temp. memory for QR-decomp.
        J11 = new Float64Array(MX*NX),
        J21 = new Float64Array(MX*NY*NX),
        J22 = new Float64Array(MX*NY*NP),
          D = new Float64Array(N),

      X0 = new Float64Array(N),
      F0 = new Float64Array(M),
      G0 = new Float64Array(N),

      tmp = new Float64Array( L*(L+3) >>> 1 ),

      // If NX < NY, we can use the prepare() step to reduce the work computeNewtonRegularized(λ) which should speed up Levenberg-Marquardt
      prepared_J21 = NY <= NX ? J21                : new Float64Array(MX*NX*NX + NX), // <- +NX as temp. memory for QR decomp.
      prepared_J22 = NY <= NX ? J22                : new Float64Array(K*NP),
      prepared_QF  = NY <= NX ? F0.subarray(MX*NX) : new Float64Array(K),

      // Working memory and result of computeNewton()
      newton_R11 = new Float64Array(MX * NX), // <- after computeNewton(), contains diagonal of R11
      newton_R21 = new Float64Array(MX*L*NX), // <- after computeNewton(), contains sines of givens rotations used to compute off diagonal entries of R11 and R12
      newton_R22 = new Float64Array(K*NP),    // <- after computeNewton(), contains R22 which is dense
      newton_P   = new   Int32Array(NP),
      newton_dX  = new Float64Array(N),

      // Working memory and result of computeNewtonRegularized(λ)
      regularized_R11 = new Float64Array(MX * NX),
      regularized_R21 = new Float64Array(MX*L*NX),
      regularized_R22 = new Float64Array( Math.max(K,NP+1) * NP ),
      regularized_P   = new   Int32Array(NP),
      regularized_dX  = new Float64Array(N),

        QF = new Float64Array( Math.max(MX*NX + K, N+1) ),
      norm = new Float64Array(2*NP),

      _consider_J11 = J11.slice(),
      _consider_J21 = dy_dx.data,
      _consider_J22 = dy_dp.data;

    _consider_J11.fill(1.0);

    Object.assign(this, {
      MX,NX,NY, NP, M,N,

      loss: 0.0,
      rank: -1,
      _report_state: REPORT_STATE_NA,
      fgg,
      report_p        :  p0,
      report_dx       : dx0,
      report_loss     : NaN,
      report_dloss_dp : null,
      report_dloss_ddx: null,
      report_dy       : dy,

      p_shape:  p0.shape,
      x_shape: dx0.shape,
      y_shape: dy .shape,

      QF,
      J11,
      J21,J22,
      tmp,

      prepared_QF,
      prepared_J21,
      prepared_J22,
      prepared: false,

      newton_R11,
      newton_R21,
      newton_R22,
      newton_P,
      newton_dX,

      regularized_R11,
      regularized_R21,
      regularized_R22,
      regularized_P,
      regularized_dX,

      _consider_J11,
      _consider_J21,
      _consider_J22,
      D, norm,
      X0,F0,G0
    });
    Object.seal(this);

    this._considerMove_computeLoss();
    this.makeConsideredMove();
  }


  _considerMove_computeLoss()
  {
    const {
      M, MX,NX,NY,NP,
      x_shape,
      p_shape,
      _consider_J11: J11,
      _consider_J21: J21,
      _consider_J22: J22
    } = this;

    this._report_state = REPORT_STATE_CONSIDER;

    const report_dloss_dp = new Float64Array(NP),
          report_dloss_ddx= new Float64Array(MX*NX),
          report_dx = this.report_dx.data,
          report_dy = this.report_dy.data;

    // COMPUTE LOSS GRADIENT w.r.t. P
    for( let i=MX*NY; i-- > 0; )
    for( let j=NP   ; j-- > 0; )
      report_dloss_dp[j] += report_dy[i] * J22[NP*i+j] / M * 2;

    // COMPUTE LOSS GRADIENT w.r.t. ΔX
    for( let i=MX; i-- > 0; )
    for( let j=NX; j-- > 0; )
      report_dloss_ddx[NX*i+j]  = J11[NX*i+j] * report_dx[NX*i+j] / M * 2;

    for( let i=MX; i-- > 0; )
    for( let j=NY; j-- > 0; )
    for( let k=NX; k-- > 0; )
      report_dloss_ddx[NX*i+k] += J21[NX*(NY*i+j)+k] * report_dy[NY*i+j] / M * 2;

    // COMPUTE LOSS (mean squared error)
    let report_loss = 0.0;
    for( let i=MX*NX; i-- > 0; ) {
      const          s = report_dx[i];
      report_loss += s*s / M;
    }
    for( let i=MX*NY; i-- > 0; ) {
      const          s = report_dy[i];
      report_loss += s*s / M;
    }

    this.report_dloss_dp = new NDArray(p_shape, report_dloss_dp );
    this.report_dloss_ddx= new NDArray(x_shape, report_dloss_ddx);
    this.report_loss     = report_loss;
  }


  considerMove( dX )
  {
    const {
      M,N, MX,NX,NY,NP,
      x_shape,
      y_shape,
      p_shape,
      _consider_J11, 
      _consider_J21, 
      _consider_J22,
      J11,
      J21,J22, F0,X0, fgg
    } = this;

    if( dX.length !== N  ) throw new Error('Assertion failed.');

    const report_p  = new Float64Array(NP),
          report_dx = new Float64Array(MX*NX);
     this.report_p  = new NDArray(p_shape, report_p );
     this.report_dx = new NDArray(x_shape, report_dx);

    for( let i=NP; i-- > 0; ) {
      const                    I = MX*NX + i;
      report_p[i] = X0[I] + dX[I];
    }

    for( let i=MX*NX; i-- > 0; )
      report_dx[i] = X0[i] + dX[i];

    let [dy, dy_dp, dy_dx] = fgg(
      new NDArray( p_shape, report_p .slice() ),
      new NDArray( x_shape, report_dx.slice() )
    );

    dy    =   array('float64', dy);
    dy_dp = asarray('float64', dy_dp);
    dy_dx = asarray('float64', dy_dx);

    if( dy   .ndim !== y_shape.length     ) throw new Error('Assertion failed.');
    if( dy_dp.ndim !== y_shape.length + 1 ) throw new Error('Assertion failed.');
    if( dy_dx.ndim !== y_shape.length +
                       x_shape.length - 1 ) throw new Error('Assertion failed.');

    if( dy   .shape[0] !== MX ) throw new Error('Assertion failed.');
    if( dy_dp.shape[0] !== MX ) throw new Error('Assertion failed.');
    if( dy_dx.shape[0] !== MX ) throw new Error('Assertion failed.');

    if(                         dy_dp.shape[y_shape.length] !== NP ) throw new Error('Assertion failed.');
    if( x_shape.length === 2 && dy_dx.shape[y_shape.length] !== NX ) throw new Error('Assertion failed.');

    if( y_shape.length === 2 )
    {
      if( dy   .shape[1] !== NY ) throw new Error('Assertion failed.');
      if( dy_dp.shape[1] !== NY ) throw new Error('Assertion failed.');
      if( dy_dx.shape[1] !== NY ) throw new Error('Assertion failed.');
    }

    this.report_dy = dy;
    dy_dx = dy_dx.data;
    dy_dp = dy_dp.data;

    for( let i=MX*NY*NX; i-- > 0; ) _consider_J21[i] = dy_dx[i];
    for( let i=MX*NY*NP; i-- > 0; ) _consider_J22[i] = dy_dp[i];
                                    _consider_J11.fill(1.0);

    this._considerMove_computeLoss();

    let predict_loss = 0.0;
    for( let i=MX*NX; i-- > 0; ) {
      const           f = F0[i] + J11[i] * (report_dx[i] - X0[i]);
      predict_loss += f*f / M;
    }

    for( let i=MX; i-- > 0; )
    for( let j=NY; j-- > 0; )
    {
      let f = F0[MX*NX + NY*i+j];
      for( let k=NX; k-- > 0; ) f += J21[NX*(NY*i+j)+k] * (report_dx[NX*i+k] - X0[NX*i+k]);
      for( let k=NP; k-- > 0; ) f += J22[NP*(NY*i+j)+k] * (report_p[k]       - X0[MX*NX + k]);
      predict_loss += f*f / M;
    }

    return [ predict_loss,
         this.report_loss ];
  }


  makeConsideredMove()
  {
    if( this._report_state !== REPORT_STATE_CONSIDER )
      throw new Error('Assertion failed.');

    this._report_state = REPORT_STATE_READY;

    this.loss = this.report_loss;
    this.rank = -1;
    this.prepared = false;

    // swap in consideration
    const {
      MX,NX,NY,NP,
      _consider_J11, J11,
      _consider_J21, J21,
      _consider_J22, J22,
      D,
      X0,F0,G0
    } = this;

    for( let i=MX*NX   ; i-- > 0; ) J11[i] = _consider_J11[i];
    for( let i=MX*NY*NX; i-- > 0; ) J21[i] = _consider_J21[i];
    for( let i=MX*NY*NP; i-- > 0; ) J22[i] = _consider_J22[i];
  
    ;{
      const p = this.report_p .data,
           dx = this.report_dx.data,
           dy = this.report_dy.data;

      for( let i=NP   ; i-- > 0; ) X0[MX*NX + i] =  p[i];
      for( let i=MX*NX; i-- > 0; ) X0[        i] = dx[i];

      for( let i=MX*NY; i-- > 0; ) F0[MX*NX + i] = dy[i];
      for( let i=MX*NX; i-- > 0; ) F0[        i] = X0[i];
    }

    // COMPUTE GRADIENT OF (HALF) SQUARED ERROR (MIND THE HALF :P)
    for( let i=MX*NX; i-- > 0; ) G0[i] = J11[i] * F0[i];

    for( let i=MX; i-- > 0; )
    for( let j=NY; j-- > 0; )
    for( let k=NX; k-- > 0; )
      G0[NX*i+k] += J21[NX*(NY*i+j)+k] * F0[MX*NX + NY*i+j];

    G0.fill(0.0, MX*NX, MX*NX+NP);
    for( let i=MX*NY; i-- > 0; )
    for( let j=NP   ; j-- > 0; )
      G0[MX*NX + j] += J22[NP*i+j] * F0[MX*NX + i];

    const norm = new FrobeniusNorm();

    for( let i=MX; i-- > 0; )
    for( let k=NX; k-- > 0; ) { norm.reset();
                                norm.include( J11[NX*i+k] );
      for( let j=NY; j-- > 0; ) norm.include( J21[NX*(NY*i+j)+k] );
      const             I = NX*i+k;
      D[I] = Math.max(D[I], norm.result);
    }

    for( let j=NP; j-- > 0; ) {    norm.reset();
      for( let i=MX*NY; i-- > 0; ) norm.include( J22[NP*i+j] );
      const             J = MX*NX + j;
      D[J] = Math.max(D[J], norm.result);
    }
  }


  cauchyTravel()
  {
    const {
      N,MX,NX,NY,NP,
      J11,
      J21,J22,
      G0: G
    } = this;

    // polynomial along the gradient const1 + 2ax + bx² = const2 + (a/b + x)² * b
    let a=0,
        b=0;

    for( let i=N; i-- > 0; )
      a += G[i]*G[i];

    for( let i=MX; i-- > 0; )
    for( let j=NY; j-- > 0; )
    {
      let Jg = 0;

      for( let k=NP; k-- > 0; ) Jg += J22[NP*(NY*i+j)+k] * G[MX*NX + k];
      for( let k=NX; k-- > 0; ) Jg += J21[NX*(NY*i+j)+k] * G[NX*i+k];

      b += Jg * Jg;
    }

    for( let i=MX*NX; i-- > 0; ) {
      const     Jg = J11[i] * G[i];
      b += Jg * Jg;
    }

    return 0===a ? 0 :
           0===b ? -Infinity : -a/b;
  }


  report()
  {
    if( this._report_state !== REPORT_STATE_READY )
      throw new Error('TrustRegionSolverLSQ::report: can only be called once after each makeConsideredMove() but not directly after considerMove(dX).');
    this._report_state = REPORT_STATE_NA;

    const result = [
      this.report_p,
      this.report_dx,
      this.report_loss,
      this.report_dloss_dp,
      this.report_dloss_ddx,
      this.report_dy
    ];

    this.report_p        =
    this.report_dx       =
    this.report_dy       =
    this.report_dloss_dp =
    this.report_dloss_ddx= null;
    this.report_loss     = NaN;

    return result;
  }


  wiggle()
  {
    throw new OptimizationNoProgressError('Too many unsuccessfull iterations.');
  }


  __DEBUG_J( i, j ) // <- meant for debugging only!
  {
    if( i%1 !== 0 ) throw new Error('Assertion failed.');
    if( j%1 !== 0 ) throw new Error('Assertion failed.');

    i |= 0;
    j |= 0;

    if( !( 0 <= i ) ) throw new Error('Assertion failed.');
    if( !( 0 <= j ) ) throw new Error('Assertion failed.');

    const {
      M,N, MX,NX,NY,NP,
      J11,
      J21,J22
    } = this;

    if( !( i < M ) ) throw new Error('Assertion failed.');
    if( !( j < N ) ) throw new Error('Assertion failed.');

    if( i < MX*NX ) return i === j ? J11[i] : 0;
        i-= MX*NX;
    if( j < MX*NX ) {
      const I = i/NY | 0,
            J = j/NX | 0;

      if( I !== J ) return 0;

      i = i%NY;
      j = j%NX;

      return J21[NX*(NY*I+i)+j];
    }

    j-= MX*NX;
    return J22[NP*i+j];
  }


  scaledNorm( X )
  {
    const {N,D} = this;

    if( X.length !== N ) throw new Error('Assertion failed.');

    const                    norm = new FrobeniusNorm();
    for( let i=N; i-- > 0; ) norm.include(D[i]*X[i]);
    return                   norm.result;
  }


  // The (ODR) trust-region solver decomposes J into:
  //
  // J = Q·R·V·D
  //
  // Q: float[M,M], orthogonal
  // R: float[M,N], upper triangular
  // V: float[N,N], orthogonal
  // D: float[N,N], diagonal scaling matrix
  //
  // Where Q is only available implicitly via QF which is the product (Q·F).
  // This method returns [R,V,D] for debugging purposes, where D is returned
  // as row vector.
  get __DEBUG_RVD() // <- meant for debugging only!
  {
    const {
      M,N, MX,NX,NY,NP,
      newton_R11: R11,
      newton_R21: R21,
      newton_R22: R22,
      newton_P  : P,
      prepared_J21: J21,
      prepared_J22: J22
    } = this;

    if( ! (0 <= this.rank) )
      throw new Error('Assertion failed.');

    const L = Math.min(NX,NY),
        rnk = this.rank - MX*NX,
          R = new Float64Array(M*N),
          V = new Float64Array(N*N),
          D = new Float64Array(1*N);
    D.fill(1.0);

    for( let i=0; i < MX*NX; i++ )
      V[N*i+i] = 1;

    for( let i=0; i < NP; i++ )
      V[N*(MX*NX +   i ) +
          (MX*NX + P[i])] = 1;

    // diag(R11)
    for( let i=0; i < MX*NX; i++ )
      R[N*i+i] = R11[i];

    // triu(R11,+1)
    for( let i=0  ; i < MX; i++ )
    for( let j=0  ; j < NX; j++ )
    for( let k=1+j; k < NX; k++ )
    for( let l=0  ; l <  L; l++ )
      R[N*(NX*i + j) +
          (NX*i + k) ] += R21[NX*(L*i+l) + j] *
                          J21[NX*(L*i+l) + k];

    // R12
    for( let i=0; i < MX; i++ )
    for( let j=0; j < NX; j++ )
    for( let k=0; k < NP; k++ )
    for( let l=0; l <  L; l++ )
      R[N*(NX*i  + j) +
          (NX*MX + k) ] += R21[NX*(L*i+l) +   j ] *
                           J22[NP*(L*i+l) + P[k]];

    // R22
    for( let i=0; i < rnk; i++ )
    for( let j=0; j < rnk; j++ )
      R[N*(MX*NX + i) +
          (MX*NX + j)] = R22[NP*i+j];

    if( rnk !== NP )
    {
      for( let i=MX*NX + NP; i-- > MX*NX; )
        D[i] = this.D[i] || 1;

      // APPLY SCALING TO R12 
      for( let j=NP; j-- > 0; )
      { const      D_j = this.D[MX*NX + P[j]];
         if( 0 !== D_j )
           for( let i=MX*NX; i-- > 0; ) R[N*i + (MX*NX + j)] /= D_j;
      }

      // APPLY GIVENS ROTATIONS TO R12
      for( let i=rnk; i-- >  0 ; )
      for( let j= NP; j-- > rnk; )
      {
        const s = R22[NP*i+j]; if(s===0) continue;
        const c = Math.sqrt(1 - s*s);
        for( let k=MX*NX; k-- > 0; ) {
          const     ki = N*k + (MX*NX + i),
                    kj = N*k + (MX*NX + j),
          R_ki  = R[ki],
          R_kj  = R[kj];
          R[ki] = R_kj*s + c*R_ki;
          R[kj] = R_kj*c - s*R_ki;
        }
      }
      for( let i=MX*NX     ; i-- >  0 ; )
      for( let j=MX*NX + NP; j-- > MX*NX + rnk; )
        R[N*i+j] = 0;

      // APPLY GIVENS ROTATIONS TO V
      for( let i=rnk; i-- >  0 ; )
      for( let j= NP; j-- > rnk; )
      {
        const s = R22[NP*i+j]; if(0===s) continue;
        const c = Math.sqrt(1 - s*s);
        _giv_rot_rows(V,N, N*(MX*NX+i),
                           N*(MX*NX+j), c,s);
      }
    }

    return [
      new NDArray( Int32Array.of(M,N), R ),
      new NDArray( Int32Array.of(N,N), V ),
      new NDArray( Int32Array.of(1,N), D )
    ];
  }


  _qr_decomp( R11,R21,R22, P, QF )
  {
    const {
      MX,NX,NY,NP,
      norm,
      tmp: Q,
      prepared_J21: J21,
      prepared_J22: J22
    } = this;

    const L = Math.min(NX,NY),
          K = Math.min(MX*NY, MX*NX + NP);

    if( ! ( P instanceof Int32Array) ) throw new Error('Assertion failed.');
    if(     P.length !== NP          ) throw new Error('Assertion failed.');
    if(   R11.length !== MX*NX       ) throw new Error('Assertion failed.');
    if(   R21.length !== MX*L*NX     ) throw new Error('Assertion failed.');
    if(   R22.length !==(NP+1)*NP
       && R22.length !== Math.min(MX*NY,
                                  MX*NX + NP+1)*NP ) throw new Error('Assertion failed: ' + JSON.stringify({len: R22.length, MX,NX,NP}) );
    //
    // STEP 2.1: ELIMINATE R21 USING GIVENS ROTATIONS
    //           O( MX*(NX+NP) ) operations
    //
    if( 1 === L )
    {
      // THIS BRANCH IS PURELY FOR PERFORMANCE REASONS
      //   - JIT compilers seem to be unable to optimize for L===1
      //   - With this branch takes half as long as without it for L===1
      //   - TODO: remove once JIT compilers become better
      for( let i=0; i < MX; i++ )
      {
        let cc = 1;

        for( let j=0; j < NX; j++ )
        { const            ij = NX*i+j,
                r1   = R11[ij],
                r2   = J21[ij] * cc,
            [c,s,nrm]=_giv_rot_qr(r1,r2);
          if(0===nrm)
            throw new Error('Assertion failed: Sparse part of J must not be singular.');

          R21[ij] = cc * s; if( s === 0 ) continue;
                    cc *=c;
          R11[ij] = nrm;

          _giv_rot_rows(QF,1, ij,MX*NX+i, c,s);
        }

        for( let j=0; j < NP; j++ )
          R22[NP*i+j] = cc * J22[NP*i+j];
      }
    }
    else
    {
      for( let i=0; i < MX; i++ ) // <- for each block i
      {
        // Q keeps track of rotations in block
        Q.fill(0.0,  /*start=*/L,/*end=*/L*(L+3) >>> 1);
        // init Q to:
        //     ┏                  ┓
        //     ┃ 0                ┃
        //     ┃ 1                ┃
        //     ┃    1             ┃
        // Q = ┃       .          ┃
        //     ┃          .       ┃
        //     ┃             .    ┃
        //     ┃                1 ┃
        //     ┗                  ┛
        // (Q[1:] is stored sparsly as the upper off-diagonal entries will always be 0)
        for( let i=L; i > 0; i-- )
          Q[L-1 + ( i*(i+1) >>> 1 )] = 1;

        for( let k=0; k < NX; k++ ) // <- for each column in block i
        {
          Q.fill(0.0, 0,L);

          let r1 = R11[NX*i+k];
          for( let j=0; j < L; j++ ) // <- for each entry j in column k of block i
          {
            const Q_off = L + ( j*(j+1) >>> 1 );

            let                       r2 = 0.0;
            for( let l=-1; l++ < j; ) r2+= Q[Q_off+l] * J21[NX*(L*i+l)+k];

            if( 0 === r2) continue;

            const [c,s,nrm] = _giv_rot_qr(r1,r2);
            r1 = nrm;

            if( 0 === s ) continue

            _giv_rot_rows(Q,j+1, 0,Q_off, c,s);
            _giv_rot_rows(QF, 1, NX*i+k,
                                 MX*NX + L*i+j, c,s);
          }
          R11[NX*i+k] = r1;

          // write finished row of Q to R21
          for( let j=0; j < L; j++ )
            R21[NX*(L*i+j)+k] = Q[j];
        }

        // apply Q to J22
        R22.fill(0.0, NP*L*i, NP*L*(i+1));
        for( let j=0; j <  L; j++ ) { const Q_off = L + ( j*(j+1) >>> 1 );
        for( let k=0; k <= j; k++ )
        for( let l=0; l < NP; l++ )
          R22[NP*(L*i+j)+l] += Q[Q_off+k] * J22[NP*(L*i+k)+l];
        }
      }
    }

    // copy remaining rows of R22
    for( let i=MX*L*NP; i < K*NP; i++ )
       R22[i] = J22[i];

    //
    // STEP 2.3: RRQR-DECOMPOSE R22
    //           O( min(MX,NP)*NP*MX ) operations
    //
    for( let i=NP; i-- > 0; ) P[i] = i;

     _rrqr_decomp_inplace(K,NP,1, R22,0, QF,MX*NX, P,0, norm);
    const rnk =_rrqr_rank(K,NP,   R22,0, norm);

    R22.fill(0.0, NP * rnk,
                  NP * Math.min(K,NP)); // <- zero out the rank-deficient rows after RRQR

    return rnk;
  }


  _qr_solve( R11,R21,R22, P, rnk, X )
  {
    const {
      MX,NX,NY,NP,
      prepared_J21: J21,
      prepared_J22: J22,
      D,    tmp: Jx,
      norm: tmp
    } = this;

    const L = Math.min(NX,NY);

    if( ! ( P instanceof Int32Array)) throw new Error('Assertion failed.');
    if(     P.length !== NP         ) throw new Error('Assertion failed.');
    if(   R11.length !== MX*NX      ) throw new Error('Assertion failed.');
    if(   R21.length !== MX*L*NX    ) throw new Error('Assertion failed.');
    if( !(R22.length  >= MX*L*NP   )) throw new Error('Assertion failed.');

    if(  0 !== rnk%1) throw new Error('Assertion failed.');
    if(!(0  <= rnk) ) throw new Error('Assertion failed.');
    if(!(NP >= rnk) ) throw new Error('Assertion failed.');
    rnk |= 0;

    //
    // STEP 3.1: BACKWARDS SUBSITUTION OF R2-PART
    //           O( rnk² ) operations
    //
    _triu_solve(rnk,NP,1, R22,0, X,MX*NX);

    if( rnk != NP )
    { //
      // STEP 3.2: APPLY GIVENS ROTATIONS TO X (UNDO 2.4)
      //           O( rnk * (NP-rnk) ) operations
      //
      for( let i= 0 ; i < rnk; i++ )
      for( let j=rnk; j < NP ; j++ )
      {
        const s = R22[NP*i+j]; if(s===0) continue;
        const c = Math.sqrt(1 - s*s);
        _giv_rot_rows(X,1, MX*NX + j,
                           MX*NX + i, c,s);
      }
    }

    //
    // STEP 3.3: APPLY COLUMN PERMUTATIONS P TO X (UNDO 2.3)
    //           O( NP ) operations
    //
    for( let i=NP; i-- > 0; )                tmp[P[i]] = X[MX*NX + i];
    for( let i=NP; i-- > 0; ) X[MX*NX + i] = tmp[  i ];

    // factor out scaling
    if( rnk !== NP )
    {
      for( let i=NP; i-- > 0; ) {
        const     d = D[MX*NX + i];
        if( 0 !== d )
          X[MX*NX + i] /= d;
      }
    }

    //
    // STEP 3.4: MOVE SOLVED R22-PART TO THE RIGHT
    //           O( MX*(NX+NP) ) operations
    // -------------------------------------------
    // As a result of steps 2.1 and 2.2, each row in R12 can be described as
    // a scaled row of J22, i.e.:
    //
    // R12[MX*j+i,:] = s[i,j] * J22[i,:]
    //
    // Where:
    //
    // s[i,j] = R21[i,j] * c[i,j-1]
    // s[i,0] = R21[i,0]
    // c[i,j] = sqrt( 1 - (s[i,j])² )
    //
    for( let i=MX; i-- > 0; )
    for( let j= L; j-- > 0; )
    {
      let xj = 0.0;
      for( let k=NP; k-- > 0; )
        xj += J22[NP*(L*i+j)+k] * X[MX*NX + k];

      for( let k=NX; k-- > 0; )
        X[NX*i+k] -= xj * R21[NX*(L*i+j)+k];
    }


    // TODO: The following can be done more efficient as the off-diagonal rows of R11 are scaled rows of J21
    //
    // STEP 3.5: BACKWARD SUBSTITUTION OF R11
    //           O( MX*NX ) operations
    for( let i=MX; i-- > 0; ) // <- for each block bottom to top
    {
      Jx.fill(0.0, 0,L);
      for( let k=NX; k-- > 0; ) // <- for each diagonal entry in block bottom to top
      { const                      ik = NX*i+k;
        for( let j=L; j-- > 0; ) X[ik] -= R21[NX*(L*i+j)+k] * Jx[j]; // <- move partial solution to the right side
                                 X[ik] /= R11[ik];
        for( let j=L; j-- > 0; ) Jx[j] += J21[NX*(L*i+j)+k] * X[ik]; // <- Jx accumulates the part to be moved to the right side
      }
    }
  }


  _rt_solve( R11,R21,R22, P, rnk, X )
  {
    const {
      MX,NX,NY,NP,
      prepared_J21: J21,
      prepared_J22: J22,
      D,    tmp: sx,
      norm: tmp
    } = this;

    const L = Math.min(NX,NY);

    if( ! ( P instanceof Int32Array) ) throw new Error('Assertion failed.');
    if(     P.length !== NP          ) throw new Error('Assertion failed.');
    if(   R11.length !== MX*NX       ) throw new Error('Assertion failed.');
    if(   R21.length !== MX*L*NX     ) throw new Error('Assertion failed.');
    if( !(R22.length >=  MX*NP     ) ) throw new Error('Assertion failed.');
    if( !(  X.length >=  MX*NX+NP  ) ) throw new Error('Assertion failed.');

    if(  0 !== rnk%1) throw new Error('Assertion failed.');
    if(!(0  <= rnk) ) throw new Error('Assertion failed.');
    if(!(NP >= rnk) ) throw new Error('Assertion failed.');
    rnk |= 0;

    //
    // STEP 4.1: SOLVE SPARSE PART
    //           O( MX*(NX+NP) ) operations
    //
    tmp.fill(0.0, 0,NP); // <- accumulates sparse part of solution to be moved to right side (because we have to apply givens rotations to it before moving it to the right side)
    for( let i=0; i < MX; i++ )
    {
      sx.fill(0.0, 0,L);

      // forward substitute block
      for( let k=0; k < NX; k++ )
      { const                        ik = NX*i+k;
        for( let j=0; j < L; j++ ) X[ik] -= J21[NX*(L*i+j)+k] * sx[j];
                                   X[ik] /= R11[ik];
        for( let j=0; j < L; j++ ) sx[j] += R21[NX*(L*i+j)+k] * X[ik];
      }

      // move solved block to right hand side
      for( let j=0; j <  L; j++ )
      for( let k=0; k < NP; k++ )
        tmp[k] += sx[j] * J22[NP*(L*i+j) + P[k]];
    }

    if( rnk < NP )
    {
      for( let i=NP; i-- > 0; ) {
        const     d = D[MX*NX + P[i]];
        if( 0 !== d )
          tmp[i] /= d;
      }

      for( let i=rnk; i-- >  0 ; )
      for( let j= NP; j-- > rnk; )
      {
        const s = R22[NP*i+j]; if(s===0) continue;
        const c = Math.sqrt(1 - s*s);
        _giv_rot_rows(tmp,1, i,j, c,s);
      }
    }

    for( let j=rnk; j-- > 0; )
      X[MX*NX + j] -= tmp[j];

    _triu_t_solve(rnk,NP,1, R22,0, X,MX*NX);
  }


  prepare()
  {
    const {
      MX,NX,NY,NP,
      prepared_J21: J21,
      prepared_J22: J22,
      prepared_QF :  QF,
      J21: raw_J21,
      J22: raw_J22,
      F0 : raw_F
    } = this;

        this.prepared = this.prepared || NX >= NY; // <- FIXME: NX >= NY
    if( this.prepared ) return;
        this.prepared = true;

    // IF BLOCKS IN J21 ARE PORTRAIT-SHAPED, WE CAN PRECOMPUTE SOME WORK TO MAKE computeNewtonRegularized(λ) CHEAPER
    // ┏           ╷   ┓      ┏           ╷   ┓
    // ┃ ╲         ┊   ┃      ┃ ╲         ┊   ┃
    // ┃   ╲       ┊   ┃      ┃   ╲       ┊   ┃
    // ┃     ╲     ┊ 0 ┃      ┃     ╲     ┊ 0 ┃
    // ┃       ╲   ┊   ┃      ┃       ╲   ┊   ┃
    // ┃         ╲ ┊   ┃      ┃         ╲ ┊   ┃
    // ┃┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┃      ┃┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┃
    // ┃ ██        ┊██ ┃      ┃ ▜█        ┊██ ┃
    // ┃ ██        ┊██ ┃  =>  ┃  ▜        ┊██ ┃
    // ┃ ██        ┊██ ┃      ┃   ▜█      ┊██ ┃
    // ┃   ██      ┊██ ┃      ┃    ▜      ┊██ ┃
    // ┃   ██      ┊██ ┃      ┃     .     ┊██ ┃
    // ┃   ██      ┊██ ┃      ┃      .    ┊██ ┃
    // ┃     .     ┊██ ┃      ┃       .   ┊██ ┃
    // ┃      .    ┊██ ┃      ┃         ▜█┊██ ┃
    // ┃       .   ┊██ ┃      ┃          ▜┊██ ┃
    // ┃         ██┊██ ┃      ┃           ┊▜█ ┃
    // ┃         ██┊██ ┃      ┃           ┊ ▜ ┃
    // ┃         ██┊██ ┃      ┃           ┊   ┃
    // ┗           ╵   ┛      ┗           ╵   ┛

    if( J21.length !== MX*NX*NX + NX                   ) throw new Error('Assertion failed.');
    if( J22.length !== Math.min(MX*NY, MX*NX + NP+1)*NP) throw new Error('Assertion failed.');
    if(  QF.length !== Math.min(MX*NY, MX*NX + NP+1)   ) throw new Error('Assertion failed.');

    for( let l=-1,
             i= 0; i < MX; i++ )
    {
      const J21_off = NX*NX*i,
            J22_off = NP*NX*i,
             QF_off =    NX*i;
      // copy upper square region
      for( let j=0; j < NX*NX; j++ ) J21[J21_off + j] = raw_J21[     NX*NY*i + j];
      for( let j=0; j < NX*NP; j++ ) J22[J22_off + j] = raw_J22[     NP*NY*i + j];
      for( let j=0; j < NX   ; j++ )  QF[ QF_off + j] = raw_F  [MX*NX + NY*i + j];

      // QR decomp. square region
      for( let j=1; j < NX; j++ ) {
      for( let k=0; k <  j; k++ ) {
        const jk = J21_off + NX*j+k, R_jk = J21[jk]; if(R_jk===0) continue;
        const kk = J21_off + NX*k+k, R_kk = J21[kk], [c,s,nrm] = _giv_rot_qr(R_kk,R_jk);
          J21[jk]= 0; if(0===s) continue;
          J21[kk]= nrm;
        _giv_rot_rows(J21,NX-1-k,   kk+1,
                                    jk+1,     c,s);
        _giv_rot_rows(J22,NP, J22_off + k*NP,
                              J22_off + j*NP, c,s);
        _giv_rot_rows( QF,1,   QF_off + k,
                               QF_off + j,    c,s);
      }}

      // QR decomp. remaining rows
      for( let j=NX; j < NY; j++ )
      {
        if( ++l===NP ) // <- more than NP rows at bottom of J22 -> start QR decomp.
          _qr_decomp_inplace(NP,NP,1, J22,MX*NX*NP,
                                       QF,MX*NX);
        l = Math.min(l,NP);
        // copy row
        for( let k=0; k < NX; k++ ) J21[J21_off + NX*NX + k] = raw_J21[     NX*NY*i + NX*j + k];
        for( let k=0; k < NP; k++ ) J22[(MX*NX + l)*NP  + k] = raw_J22[     NP*NY*i + NP*j + k];
                                     QF[(MX*NX + l)        ] = raw_F  [MX*NX + NY*i +    j    ];

        // eliminate entries in J21
        for( let k=0; k < NX; k++ )
        {
          const jk = J21_off + NX*NX + k, R_jk = J21[jk]; if(R_jk===0) continue;
          const kk = J21_off + NX*k  + k, R_kk = J21[kk], [c,s,nrm] = _giv_rot_qr(R_kk,R_jk);
            J21[jk]= 0; if(0===s) continue;
            J21[kk]= nrm;
          _giv_rot_rows(J21,NX-1-k,   kk+1,
                                      jk+1,      c,s);
          _giv_rot_rows(J22,NP, J22_off + NP*k,
                                 (MX*NX + l)*NP, c,s);
          _giv_rot_rows(QF,1,    QF_off + k,
                                 (MX*NX + l),    c,s);
        }

        if( !(l <= NP) ) throw new Error('Assertion failed.');

        // more than NP trailing rows in J22 -> eliminate further rows using QR decomp.
        if( l===NP )
          for( let k=0; k < NP; k++ )
          {
            const lk = MX*NX*NP + NP*l+k, R_lk = J22[lk]; if(R_lk===0) continue;
            const kk = MX*NX*NP + NP*k+k, R_kk = J22[kk], [c,s,nrm] = _giv_rot_qr(R_kk,R_lk);
              J22[lk]= 0; if(0===s) continue;
              J22[kk]= nrm;
            _giv_rot_rows(J22,NP-1-k, kk+1,
                                      lk+1, c,s);
            _giv_rot_rows(QF,1,    MX*NX+k,
                                   MX*NX+l, c,s);
          }
      }
    }
  }



  // The Jacobian of the orthogonal least squares problem is sparse with the following structure:
  //
  //     ┏                   ╷    ┓   ┏                 ╷     ┓   
  //     ┃  ╲                ┊    ┃   ┃                 ┊     ┃
  //     ┃    ╲              ┊    ┃   ┃                 ┊     ┃
  //     ┃      ╲            ┊    ┃   ┃                 ┊     ┃
  //     ┃        ╲          ┊ 0  ┃   ┃       J11       ┊     ┃
  // J = ┃          ╲        ┊    ┃ = ┃                 ┊     ┃
  //     ┃            ╲      ┊    ┃   ┃                 ┊     ┃
  //     ┃              ╲    ┊    ┃   ┃                 ┊     ┃
  //     ┃                ╲  ┊    ┃   ┃                 ┊     ┃
  //     ┃┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┃   ┃┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┃
  //     ┃ ████              ┊ ██ ┃   ┃                 ┊     ┃
  //     ┃     ████          ┊ ██ ┃   ┃       J21       ┊ J22 ┃
  //     ┃          ...      ┊ ██ ┃   ┃                 ┊     ┃
  //     ┃              ████ ┊ ██ ┃   ┃                 ┊     ┃
  //     ┗                   ╵    ┛   ┗                 ╵     ┛
  //
  //  J  : float[MX*(NX+NY),MX*NX+NP];
  //  J11: float[MX*NX    ,MX*NX]; J11 is a Diagonal Matrix; Diag. represent the weights on Δ; Assumed to NOT be rank-deficient;
  //  J21: float[MX*NX    ,   NP]; J21 is a diagonal block matrix (possibly non-square).
  //  J22: float[MX*NY    ,   NP]; J22 is a dense matrix
  //
  // If there are no rank deficiencies in the upper left MX*NX columns, J can be sparsely QR decomposed as follows to solve ODR problem:
  // 
  //       ┏              ╷     ┓     ┏                 ╷     ┓
  //       ┃ ▜▓▓          ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃  ▜▓          ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃   ▜          ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃    ▜▓▓       ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃     ▜▓       ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃      ▜       ┊ ▓▓▓ ┃     ┃       R11       ┊ R21 ┃
  //       ┃       .      ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  // J = Q·┃        .     ┊ ▓▓▓ ┃ = Q·┃                 ┊     ┃
  //       ┃         .    ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃          ▜▓▓ ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃           ▜▓ ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃            ▜ ┊ ▓▓▓ ┃     ┃                 ┊     ┃
  //       ┃┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┃     ┃┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┼┄┄┄┄┄┃
  //       ┃              ┊ ▜██ ┃     ┃                 ┊     ┃
  //       ┃       0      ┊  ▜█ ┃     ┃                 ┊     ┃
  //       ┃              ┊   ▜ ┃     ┃        0        ┊ R22 ┃
  //       ┗              ╵     ┛     ┗                 ╵     ┛
  //
  // R11: float[MX*NX               , MX*NX]; Block diagonal matrix where each block is of size [NX,NX] and upper-triangular. Off-diagonal entries can be computed "on-demand".
  // R21: float[MX*NX               ,    NP]; Dense matrix. Entries can be computed implicitly.
  // R22: float[min(MX*NY, MX*NX+NP),    NP]; Dense upper triangular matrix.
  //
  computeNewton()
  {
    const {
      MX,NX,NY,NP,
      QF,
      J11,
      prepared_QF: F1,
      newton_R11: R11,
      newton_R21: R21,
      newton_R22: R22,
      newton_P  : P,
      newton_dX : X,
      F0, D
    } = this;

    if( this.rank  >=  0 ) return;
    if( this.rank !== -1 ) throw new Error('Assertion failed.');

    this.prepare();

    const K = Math.min(MX*NY, MX*NX + NP);

    //
    // STEP 1: MEMORY INITIALIZATION
    //

    // for R11, only the diagonal is stored in memory explicitly. Off-diagonal entries are computed "on-demand"
    for( let i=MX*NX; i-- > 0; ) R11[i] = J11[i];

    for( let i=K    ; i-- > 0; ) QF[MX*NX+i] =  F1[i];
    for( let i=MX*NX; i-- > 0; ) QF[      i] =  F0[i];

    const       rnk = this._qr_decomp(R11,R21,R22, P, QF);
    this.rank = rnk + MX*NX;

    for( let i=MX*NX+rnk; i-- > 0; )
      X[i] = -QF[i];

    if( rnk !== NP )
    { //
      // STEP 2.4: ELIMINATE RANK-DEFICIENT COLUMS
      //           O( rnk² * (NP-rnk) ) operations
      X.fill(0.0, MX*NX+rnk,
                  MX*NX+NP);

      // factor in scaling into R22
      for( let j=NP; j-- > 0; ) {
        const  d = D[ MX*NX + P[j] ];
        if(0!==d)
          for( let i=rnk; i-- > 0; )
            R22[NP*i+j] /= d;
      }

      // eliminate lower part of linear dependent columns of R22
      for( let i=rnk; i-- >  0 ; ) { const ii = NP*i+i;
      for( let j= NP; j-- > rnk; ) { const ij = NP*i+j,
                                R_ij = R22[ij]; if(0===R_ij) continue;
        const                   R_ii = R22[ii];
        // compute Givens rot.
        let [c,s,nrm] = _giv_rot_qr(R_ii,R_ij);
        if( s !== 0 )
        { if( c < 0 ) {
              c *= -1;
              s *= -1;
            nrm *= -1;
          }
          // apply Givens rot.
          for( let k=i; k-- > 0; )
          { const         R_ki = R22[NP*k+i],
                          R_kj = R22[NP*k+j];
            R22[NP*k+i] = R_kj*s + c*R_ki;
            R22[NP*k+j] = R_kj*c - s*R_ki;
          }
          R22[ii] = nrm;
        } R22[ij] = s;
      }}
    }

    this._qr_solve(R11,R21,R22, P, rnk, X);
  }



  computeNewtonRegularized( λ )
  {
          λ *= 1;
    if( !(λ >= 0) ) throw new Error('Assertion failed.');

    const {
      N,MX,NX,NY,NP,
      regularized_R11: R11, J11,
      regularized_R21: R21,
      regularized_R22: R22,
      regularized_P  : P,
      regularized_dX : X,
      D,       QF, F0,
      prepared_QF: F1
    } = this;

    const Y = QF; // <- alias to reuse memory

    const K = Math.min(MX*NY, MX*NX + NP);

    if( R22.length !== Math.max(Math.min(MX*NY, MX*NX + NP+1), NP+1) * NP    ) throw new Error('Assertion failed.');
    if(  QF.length !== Math.max(Math.min(MX*NY, MX*NX + NP+1), NP+1) + MX*NX ) throw new Error('Assertion failed.');

    if( 0 === λ )
    {
      this.computeNewton();

      const {
        newton_R11: R11,
        newton_R21: R21,
        newton_R22: R22,
        newton_P  : P,
        newton_dX,
        rank
      } = this;

      for( let i=N; i-- > 0; )
        X[i] = newton_dX[i];

      const  r = this.scaledNorm(X);
      if(0===r)
        return [0,0];

      const rnk = rank - MX*NX;

      if( rank < N )
      {
        for( let i=NP; i-- > 0; ) {
          const            j = MX*NX + P[i];
          Y[MX*NX + i] = X[j]*D[j];
        }

        for( let i=rnk; i-- >  0 ; )
        for( let j= NP; j-- > rnk; )
        {
          const s = R22[NP*i+j]; if(s===0) continue;
          const c = Math.sqrt(1 - s*s);
          _giv_rot_rows(Y,1, MX*NX + i,
                             MX*NX + j, c,s);
        }
      }
      else {
        for( let i=NP; i-- > 0; ) {
          const            j = MX*NX + P[i];
          Y[MX*NX + i] = X[j]*D[j]*D[j];
        }
      }

      for( let i=MX*NX; i-- > 0; )
        Y[i] = X[i]*D[i]*D[i];

      this._rt_solve(R11,R21,R22, P, rnk, Y);

      let dr = 0;
      for( let i=rank; i-- > 0; ) {
        const d = Y[i];
        dr += d*d;
      } dr /= -r;

      return [r,dr];
    }

    this.prepare();

    //
    // STEP 4: MEMORY INITIALIZATION
    //

    // for R11, only the diagonal is stored in memory explicitly. Off-diagonal entries are computed "on-demand"
    for( let i=MX*NX; i-- > 0; ) R11[i] = J11[i];

    for( let i=K    ; i-- > 0; ) QF[MX*NX+i] =  F1[i];
    for( let i=MX*NX; i-- > 0; ) QF[      i] =  F0[i];

    const λSqrt = Math.sqrt(λ);

    // eliminate the upper part of regularization before _qr_decomp
    // O(MX*NX) operations
    for( let i=MX*NX; i-- > 0; )
    {
      const  Dλ = D[i] * λSqrt;
      if( ! (Dλ > 0) ) throw new Error('Assertion failed.');

      const [c,s,nrm] = _giv_rot_qr(R11[i],Dλ);
      R11[i] = nrm;
       QF[i]*= c;
    }

    const rnk = this._qr_decomp(R11,R21,R22, P, QF),
      R22_end = NP*NP;

    R22.fill(0.0, K*NP, (NP+1)*NP); // <- zero out entries from previous calls to computeNewtonRegularized()

    for( let i=NP; i-- > 0; )
    { let    Dλ = D[MX*NX + P[i]];
      if(0===Dλ)
             Dλ = 1;
      else   Dλ *= λSqrt;
      if( ! (Dλ > 0) ) throw new Error('Assertion failed.');

      if( rnk <= i ) {
        // fill up the rank-deficient rows with regularization
        R22[NP*i + i] = Dλ;
        QF[MX*NX + i] = 0;
      }
      else
      { // eliminate remaining regularization entries (using Givens QR)
        R22[R22_end+i] = Dλ;
         QF[N] = 0;

        for( let j=i; j < NP; j++ )
        {
          const jj = NP*j+j,
                ij = R22_end + j,
              R_jj = R22[jj],
              R_ij = R22[ij],
          [c,s,nrm]= _giv_rot_qr(R_jj,R_ij); 
          R22[ij] = 0; if( s === 0 ) continue;
          R22[jj] = nrm;
          _giv_rot_rows(R22,NP-j-1, jj+1,
                                    ij+1, c,s);
          _giv_rot_rows(QF,1, MX*NX + j,N, c,s);
        }
      }
    }

    for( let i=N; i-- > 0; )
      X[i] = -QF[i];

    this._qr_solve(R11,R21,R22, P, NP, X);

    const  r = this.scaledNorm(X);
    if(0===r)
      return [0,0];

    for( let i=NP; i-- > 0; ) {
      const            j = MX*NX + P[i];
      Y[MX*NX + i] = X[j]*D[j]*D[j];
    }

    for( let i=MX*NX; i-- > 0; )
      Y[i] = X[i]*D[i]*D[i];

    this._rt_solve(R11,R21,R22, P, NP, Y);

    let dr = 0;
    for( let i=N; i-- > 0; ) {
      const d = Y[i];
      dr += d*d;
    } dr /= -r;

    return [r,dr];
  }
}
