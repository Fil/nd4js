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
 * along with ND.JS. If not, see <http://www.gnu.org/licenses/>.
 */

import {asarray, NDArray} from '../../nd_array'


// REFERENCES
// ----------
// .. [1] "Testing Unconstrained Optimization Software"
//         Jorge J. Moré, Burton S. Garbow, Kenneth E. Hillstrom
//         ACM Transactions on Mathematical Software, Vol 7, No. 1, March 1982, pp. 17-41
// .. [2] "A Hybrid Method for Nonlinear Equations"
//         M.J.D. Powell
//         In "Numerical Methods for Nonlinear Algebratic Equations", Gordon & Breach, New York, 1970, pp. 87-114


export const beale = x =>
{
  x = asarray(x)

  if(         x.ndim     <  1 ) throw new Error('beale(x): x.ndim must be at least 1.');
  if( x.shape[x.ndim-1] !== 2 ) throw new Error('beale(x): x.shape[-1] must be 2.');

  const F_shape = x.shape.slice(0,-1),
        F       = new (x.dtype==='float32' ? Float32Array
                                           : Float64Array)(x.data.length/2);
  x = x.data;

  for( let x_off=x.length,
           F_off=F.length;
           F_off-- > 0; )
  {        x_off -= 2;
    const x1 = x[x_off+0],
          x2 = x[x_off+1];

    const f1 = 1.5  - x1*(1-x2),
          f2 = 2.25 - x1*(1-x2*x2),
          f3 = 2.625- x1*(1-x2*x2*x2);

    F[F_off] = f1*f1 + f2*f2 + f3*f3;
  }

  return new NDArray(F_shape, F);
}


beale.nIn = 2;
beale.nOut= 3;


beale.minima       =
beale.minima_global=
beale.roots        = [[3, 0.5]];


beale.grad = x =>
{
  x = asarray(x)

  if(         x.ndim     <  1 ) throw new Error('beale.grad(x): x.ndim must be at least 1.');
  if( x.shape[x.ndim-1] !== 2 ) throw new Error('beale.grad(x): x.shape[-1] must be 2.');

  const G_shape = x.shape,
        G       = new (x.dtype==='float32' ? Float32Array
                                           : Float64Array)(x.data.length);
  x = x.data;

  for( let off=x.length; (off-=2) >= 0; )
  {
    const x1 = x[off+0],
          x2 = x[off+1];

    const f1 = 1.5  - x1*(1-x2),
          f2 = 2.25 - x1*(1-x2*x2),
          f3 = 2.625- x1*(1-x2*x2*x2);

    G[off+0] = 2 * ( f1*(x2-1) +
                     f2*(x2*x2-1) +
                     f3*(x2*x2*x2-1) );
    G[off+1] = 2 * x1 * ( f1*1 +
                   x2 * ( f2*2 + f3*3*x2 ));
  }

  return new NDArray(G_shape, G);
}


beale.hess = x =>
{
  x = asarray(x)

  if(         x.ndim     <  1 ) throw new Error('beale.hess(x): x.ndim must be at least 1.');
  if( x.shape[x.ndim-1] !== 2 ) throw new Error('beale.hess(x): x.shape[-1] must be 2.');

  const H_shape = Int32Array.of(...x.shape, 2),
        H = new (x.dtype==='float32' ? Float32Array
                                     : Float64Array)(x.data.length*2);
  x = x.data;

  for( let H_off=H.length,
           x_off=x.length;
          (x_off -= 2) >= 0; )
  {        H_off -= 4;
    const x1 = x[x_off+0],
          x2 = x[x_off+1];

    const f1 = 1.5  - x1*(1-x2),
          f2 = 2.25 - x1*(1-x2*x2),
          f3 = 2.625- x1*(1-x2*x2*x2);

    H[H_off+0] = 2 * ( (1-x2      ) * (1-x2      ) +
                       (1-x2*x2   ) * (1-x2*x2   ) +
                       (1-x2*x2*x2) * (1-x2*x2*x2) );
    H[H_off+1] =
    H[H_off+2] = 2 * ( 1.5         -  (1-x2)      * 2*x1 +
                       4.5  *x2    -  (1-x2*x2)   * 4*x1*x2 +
                       7.875*x2*x2 -  (1-x2*x2*x2)* 6*x1*x2*x2 );

    H[H_off+3] = 2 * ( 1*x1*x1             +
                       4*x1*x1*x2*x2       + f2*2*x1 +
                       9*x1*x1*x2*x2*x2*x2 + f3*6*x1*x2 );
  }

  return new NDArray(H_shape, H);
}


beale.lsq = x =>
{
  x = asarray(x)

  if(         x.ndim     <  1 ) throw new Error('beale.lsq(x): x.ndim must be at least 1.');
  if( x.shape[x.ndim-1] !== 2 ) throw new Error('beale.lsq(x): x.shape[-1] must be 2.');

  const F_shape = x.shape.slice(),
        F       = new (x.dtype==='float32' ? Float32Array
                                           : Float64Array)(x.data.length/2*3);
  F_shape[F_shape.length-1] = 3;
  x = x.data;

  for( let x_off = x.length,
           F_off = F.length;
          (x_off-= 2) >= 0; )
  {        F_off-= 3;
    const x1 = x[x_off+0],
          x2 = x[x_off+1];

    F[F_off+0] = 1.5  - x1*(1-x2);
    F[F_off+1] = 2.25 - x1*(1-x2*x2);
    F[F_off+2] = 2.625- x1*(1-x2*x2*x2);
  }

  return new NDArray(F_shape, F);
}


beale.lsq_jac = x =>
{
  x = asarray(x)

  if(         x.ndim     <  1 ) throw new Error('beale.lsq_jac(x): x.ndim must be at least 1.');
  if( x.shape[x.ndim-1] !== 2 ) throw new Error('beale.lsq_jac(x): x.shape[-1] must be 2.');

  const J_shape = Int32Array.of(...x.shape.slice(0,-1), 3, 2),
        J       = new (x.dtype==='float32' ? Float32Array
                                           : Float64Array)(x.data.length*3);
  x = x.data;

  for( let x_off = x.length,
           J_off = J.length;
          (x_off-= 2) >= 0; )
  {        J_off-= 6;
    const x1 = x[x_off+0],
          x2 = x[x_off+1];

    J[J_off+0] =   x2       - 1;
    J[J_off+1] = 1*x1;
    J[J_off+2] =   x2*x2    - 1;
    J[J_off+3] = 2*x1*x2;
    J[J_off+4] =   x2*x2*x2 - 1;
    J[J_off+5] = 3*x1*x2*x2;
  }

  return new NDArray(J_shape, J);
}


Object.freeze(beale);
