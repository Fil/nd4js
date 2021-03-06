'use strict';

/* This file is part of ND.JS.
 *
 * ND.JS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * ND.JS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with ND.JS. If not, see <http://www.gnu.org/licenses/>.
 */

import {ARRAY_TYPES} from '../dt'
import {MutableComplex} from '../dt/mutable_complex'
import {math} from '../math'
import {asarray, NDArray} from '../nd_array'

import {AleaRNG} from '../rand/alea_rng'

import {_giv_rot_qr} from './_giv_rot'
import {hessenberg_decomp} from './hessenberg'
import {matmul2} from './matmul'


export function schur_eigenvals(T)
{
  T = asarray(T)

  const [N] = T.shape.slice(-1),
    Λ_shape = T.shape.slice(0,-1),
    Λ = new ARRAY_TYPES['complex128'](T.data.length/N)

  if( T.shape[T.ndim-2] != N )
    throw new Error('T is not square.');
  T = T.data;

  let T_off=0;
  const t = (i,j) => T[T_off + N*i+j]; 
  for( let Λ_off=0;
           T_off < T.length;
           T_off += N*N,
           Λ_off += N )
  {

    // COMPUTE EIGENVECTORS (right -> left)
    for( let j=N-1; j >= 0; j-- )
    {
      const i = j-1;
      if( 0===j || 0 == t(j,i) ) {
         //
        // 1x1 BLOCK
       //
        // the eigenvalue is the diagonal value
        Λ[Λ_off + j] = t(j,j);
      } else {
         //
        // 2x2 BLOCK
       //
        // STEP1: compute eigenpairs of the 2x2 matrix
        const T_ii = t(i,i), T_ij = t(i,j),
              T_ji = t(j,i), T_jj = t(j,j),
              diag = math.sub(T_ii,T_jj),
                tr = math.add(T_ii,T_jj),
               sqr = math.add(
                 math.mul(diag,diag),
                 math.mul( math.mul(4,T_ij), T_ji )
               );
        if( sqr >= 0 )
          throw new Error(`schur_eigenvals(T): T must not contain real eigenvalued 2x2 blocks.`);

        const   sqrt = math.mul(0.5, math.sqrt(sqr)),
                half = math.mul(0.5, tr);
        Λ[Λ_off + i] = math.add(half, sqrt);
        Λ[Λ_off + j] = math.sub(half, sqrt);
        j--;
      }
    }
  }

  return new NDArray(Λ_shape,Λ);
}


export function schur_eigen(Q,T)
{
  Q = asarray(Q);
  T = asarray(T);

  if( Q.ndim != T.ndim ) throw new Error('Q.ndim != T.ndim.');
  for( let i=T.ndim; i-- > 0; )
    if( Q.shape[i] != T.shape[i] ) throw new Error('Q.shape != T.shape.')

  const [N] = T.shape.slice(-1),
    V_shape = T.shape,
    Λ_shape = V_shape.slice(0,-1);

  // T is quasi-triangular. For simplification let's assume it's upper triangular:
  // ┌                        ┐
  // │ λ₁ ...                 │
  // │                        │
  // │ 0   λ₂ ...             │
  // │       .                │
  // │ 0   0   .              │
  // │           .            │
  // │ .       .   λₖ ...     │
  // │ .         .   .        │
  // │ .           .   .      │
  // │                   .    │
  // │ 0    ...        0   λₙ │
  // └                        ┘
  //
  // Let's say we want to find an eigenvector for λₖ, we can just solve:
  // ┌                                   ┐ ┌     ┐
  // │ λ₁-λₖ ...                         │ │ x₁  │
  // │                                   │ │     │
  // │ 0   λ₂-λₖ ...                     │ │ x₂  │
  // │          .                        │ │ .   │
  // │ 0     0    .                      │ │ .   │
  // │              .                    │ │ .   │ ! ⇀
  // │ .         .  λₖ₋₁-λₖ ...          │ │ xₖ₋₁│ = 0
  // │                                   │ │     │
  // │ .             .    λₖ-λₖ ...      │ │ 1   │
  // │                        .          │ │     │
  // │ .                 .      .        │ │ 0   │
  // │                            .      │ │ :   │
  // │ 0     .   .   .       0    λₙ-λₖ  │ │ 0   │
  // └                                   ┘ └     ┘
  //
  // Since T is quasi-triangular this is solvable via a modified Backward Substition.
  // For multiple (equivalent) eigenvalues, there is not guaranteed to be more than
  // one linearily independent eigenvector. If that is the case, we at some point
  // arrive at an row in the backward substitution where:
  //
  // (λₛ-λₖ)xₛ = 0·xₛ = 0 - T[s,s+1]·xₛ₊₁ ... - T[s,k-1]*xₖ₋₁ - T[s,k] = -xₛ ≠ 0.
  //
  // We can resolve this by setting:
  //
  // xₜ := 0; for t > s
  // xₛ := 1
  //
  // This will of course than mean that for s and k, we have the same eigenvector.
  //

  if( T.shape[T.ndim-2] != N ) throw new Error('Q is not square.');

  const ComplexArray = ARRAY_TYPES['complex128'],
        V  =     ComplexArray.from(T.data); T = undefined;
  const Λ  = new ComplexArray(V.length/N),
        V_arr = V._array,
        Λ_arr = Λ._array,
        // temporary vectors for the eigenvalue computation
        v1 = new ComplexArray(N), v1_arr = v1._array,
        v2 = new ComplexArray(N), v2_arr = v2._array,
        norm_sum = v1._array.subarray(0,N),
        norm_max = v2._array.subarray(N  );
  const v_i  = new MutableComplex(NaN,NaN),
        v_j  = new MutableComplex(NaN,NaN),
        det  = new MutableComplex(NaN,NaN);

  let TOL = NaN

  /** Computes indices j < J of an eigenvector v using backward substition (see amazing UTF-8 art above).
   */
  function computeVec( λ, v, J )
  {
    const K = Math.min(N,J+2),
      v_arr = v._array;

    for( let j=J; j-- > 0; )
    {
      for( let k=K; --k > j; ) {
        const re0 = v_arr[2*k+0], re1 = V_arr[2*(V_off + N*j+k)+0],
              im0 = v_arr[2*k+1], im1 = V_arr[2*(V_off + N*j+k)+1];
        v_arr[2*j+0] -= re0*re1 - im0*im1;
        v_arr[2*j+1] -= re0*im1 + im0*re1;
      }
      if( 0==j || t(j,j-1) == 0 )
      {  //
        // 1x1 BLOCK
       //
        const T_jj_re = V_arr[2*(V_off + N*j+j)+0] - λ.re,
              T_jj_im = V_arr[2*(V_off + N*j+j)+1] - λ.im;
        v_j.re = v_arr[2*j+0];
        v_j.im = v_arr[2*j+1];
        if( Math.hypot(T_jj_re, T_jj_im) <= TOL ) {   // <- TODO
          if( v_j.abs() <= TOL ) { // <- TODO add test case for this zeroness test
            // v is already a valid eigenvalue, let's return it
            v_arr[2*j+0] = 0;
            v_arr[2*j+1] = 0;
          }
          else {
            // v is invalid, let's reset
            v_arr[2*j] = 1.0;
            v_arr.fill(0.0, 2*j+1,2*K);
          }
        }
        else {
          v_j['/='](T_jj_re, T_jj_im)
          v_arr[2*j+0] = v_j.re;
          v_arr[2*j+1] = v_j.im;
        }
      }
      else
      {  //
        // 2x2 BLOCK
       //
        const i = j-1;
        for( let k=K; --k > j; ) {
          const re0 = v_arr[2*k+0], re1 = V_arr[2*(V_off + N*i+k)+0],
                im0 = v_arr[2*k+1], im1 = V_arr[2*(V_off + N*i+k)+1];
          v_arr[2*i+0] -= re0*re1 - im0*im1;
          v_arr[2*i+1] -= re0*im1 + im0*re1;
        }

        const T_ii_re = V_arr[2*(V_off + N*i+i)+0] - λ.re,
              T_ii_im = V_arr[2*(V_off + N*i+i)+1] - λ.im,
              T_jj_re = V_arr[2*(V_off + N*j+j)+0] - λ.re,
              T_jj_im = V_arr[2*(V_off + N*j+j)+1] - λ.im,
              T_ij_re = V_arr[2*(V_off + N*i+j)+0],
              T_ij_im = V_arr[2*(V_off + N*i+j)+1],
              T_ji_re = V_arr[2*(V_off + N*j+i)+0],
              T_ji_im = V_arr[2*(V_off + N*j+i)+1];

        det[ '= c0*c1']( /*c0=*/T_ii_re,T_ii_im, /*c1=*/T_jj_re,T_jj_im )
        det['-= c0*c1']( /*c0=*/T_ij_re,T_ij_im, /*c1=*/T_ji_re,T_ji_im )

        if( det.re===0 && det.im===0 ) throw new Error('Assertion failed.');

        v_j[ '= c0*c1']( /*c0=*/T_ii_re,T_ii_im, /*c1=*/v_arr[2*j+0],v_arr[2*j+1] );
        v_j['-= c0*c1']( /*c0=*/T_ji_re,T_ji_im, /*c1=*/v_arr[2*i+0],v_arr[2*i+1] ); v_j['/='](det.re, det.im);
        v_i[ '= c0*c1']( /*c0=*/T_jj_re,T_jj_im, /*c1=*/v_arr[2*i+0],v_arr[2*i+1] );
        v_i['-= c0*c1']( /*c0=*/T_ij_re,T_ij_im, /*c1=*/v_arr[2*j+0],v_arr[2*j+1] ); v_i['/='](det.re, det.im);

        v_arr[2*i+0] = v_i.re;
        v_arr[2*i+1] = v_i.im;
        v_arr[2*j+0] = v_j.re;
        v_arr[2*j+1] = v_j.im;
        j--;
      }
    }
  }

  let V_off=0;
  const t = (i,j) => V[V_off + N*i+j]; 
  for( let Λ_off=0; V_off < V.length; V_off += N*N,
                                      Λ_off += N )
  {
    TOL = Math.sqrt(Number.EPSILON) * function(){
      // compute Frobenius norm
      let sum=0,
          max=0
      const iEnd = V_off + N*N
      for( let i=V_off; i < iEnd; i++ )
      {
        const elem = math.abs(V[i]);
        if(   elem != 0 ) { // <- handles NaN (by making the result NaN)
          if( elem > max ) {
            sum *= (max/elem)**2; max = elem
          } sum += (elem/max)**2
        }
      }
      return Math.sqrt(sum)*max
    }();
    if( ! (TOL >= 0) )
      throw new Error('Assertion failed.')

    // COMPUTE EIGENVECTORS (right -> left)
    for( let j=N-1; j >= 0; j-- )
    {
      const i = j-1;
      if( 0==j || t(j,i) == 0 ) {
         //
        // 1x1 BLOCK
       //
        // the eigenvalue is the diagonal value
        const λ = t(j,j);
        Λ[Λ_off + j] = λ;
        // since 0*1 is zero, the eigenequation should be solvable for vec1[j] = 1
        // (unless there is a duplicate eigenvalue with linarily non-independent eigenvectors, but that will be resolved by computeVec)
        v1.fill(0.0, 0,j+2);
        v1[j] = 1;
        computeVec(λ,v1,j);
        // write the solution in the the (j+1)-th column
        for( let k=Math.min(N,j+2); k-- > 0; ) {
          V_arr[2*(V_off + N*k+j)+0] = v1_arr[2*k+0];
          V_arr[2*(V_off + N*k+j)+1] = v1_arr[2*k+1];
        }
      } else {
         //
        // 2x2 BLOCK
       //
        // STEP1: compute eigenpairs of the 2x2 matrix
        const T_ii = t(i,i), T_ij = t(i,j),
              T_ji = t(j,i), T_jj = t(j,j),
              diag = math.sub(T_ii,T_jj),
                tr = math.add(T_ii,T_jj),
               sqr = math.add(
                 math.mul(diag,diag),
                 math.mul( math.mul(4,T_ij), T_ji )
               );
        if( sqr >= 0 )
          throw new Error(`schur_eigenvals(T): T must not contain real eigenvalued 2x2 blocks.`);

        const sqrt = math.mul(0.5, math.sqrt(sqr)),
              half = math.mul(0.5, tr),
                λ1 = math.add(half, sqrt),
                λ2 = math.sub(half, sqrt);
        // TODO: the whole following section should be feasible with only a single temporary vector instead of two (vec1,vec2)
        v1_arr.fill(0.0, 0,2*(j+1));
        v2_arr.fill(0.0, 0,2*(j+1));
        // http://www.math.harvard.edu/archive/21b_fall_04/exhibits/2dmatrices/
        if( math.abs(T_ij) >= math.abs(T_ji) )
        {        v1[i] = T_ij; v1[j] = math.sub( λ1, T_ii );
                 v2[i] = T_ij; v2[j] = math.sub( λ2, T_ii );
        } else { v1[j] = T_ji; v1[i] = math.sub( λ1, T_jj );
                 v2[j] = T_ji; v2[i] = math.sub( λ2, T_jj );
        }
        computeVec(λ1,v1,i);
        computeVec(λ2,v2,i);
        for( let k=j+1; k-- > 0; ) {
          V_arr[2*(V_off + N*k+i)+0] = v1_arr[2*k+0];
          V_arr[2*(V_off + N*k+i)+1] = v1_arr[2*k+1];
          V_arr[2*(V_off + N*k+j)+0] = v2_arr[2*k+0];
          V_arr[2*(V_off + N*k+j)+1] = v2_arr[2*k+1];
        }
        Λ[Λ_off + i] = λ1;
        Λ[Λ_off + j] = λ2;
        --j;
      }
    }

    // COMPUTE COLUMN NORMS
    norm_sum.fill(0.0);
    norm_max.fill(0.0);
    for( let i=0; i < N  ; i++ )
    for( let J=0; J < N*2; J++ ) {
      const    j = J >>> 1,
            V_ij = Math.abs(V_arr[2*(V_off + N*i)+J]);
      if(   V_ij > 0 ) {
        if( V_ij > norm_max[j] ) {
          const scale = norm_max[j] / V_ij; norm_max[j] = V_ij;
          norm_sum[j] *= scale*scale;
        }
        const ratio = V_ij / norm_max[j];
        norm_sum[j] += ratio*ratio;
      }
    }
    const norm = norm_sum;
    for( let i=0; i < N; i++ ) {
      const max = norm_max[i];
      norm[i] = isFinite(max) ? Math.sqrt(norm_sum[i])*max : max;
    }

    // NORMALIZE COLUMNS
    for( let i=0; i < N; i++ )
    for( let j=0; j < N; j++ )
      V[V_off + N*i+j] = math.div(V[V_off + N*i+j], norm[j]);
  }

  return [
                new NDArray(Λ_shape, Λ),
    matmul2( Q, new NDArray(V_shape, V) ),
  ];
}

export function schur_decomp(A)
{
  A = asarray(A)
  // HESSENBERG DECOMPOSITION
  const N = A.shape[A.ndim-1],
     [Q,H]= hessenberg_decomp(A); A = undefined;
  // FRANCIS QR
  schur_qrfrancis_inplace(Q,H);
  return [Q,H];
}


/** Takes a Hessenberg Decomposition as input and performs a real Schur Decomposition IN-PLACE.
 *  Does not perform any scaling.
 *  Does not check Hessenberg property.
 */
function schur_qrfrancis_inplace(Q,H)
{
  const N = Q.shape[Q.ndim-1],
        DTypeArray = ARRAY_TYPES[Q.dtype],
        tmp = new DTypeArray(N);
  if( Q.shape[Q.ndim-2] != N ) throw new Error('Q is not square.');
  if( Q.ndim != H.ndim ) throw new Error('Q.ndim != H.ndim.')
  for( let i=Q.ndim; i-- > 0; )
    if( Q.shape[i] != H.shape[i] ) throw new Error('Q.shape != H.shape.')
  Q = Q.data;
  H = H.data;

  const TOL = Number.EPSILON;

  /** This function is recursively called to perform the Francis QR Algorithm, which is
   *  an implicit double-shift version of the QR Algorithm. This function only works on
   *  a subregion of H and an independent Q on each recursive call. That nested Q is
   *  applied to the remaining H and the outer Q once the nested schur decomposition
   *  is finished.
   *
   *  SEE: Prof. Dr. Peter Arbenz
   *       252-0504-00 G
   *       Numerical Methods for Solving Large Scale Eigenvalue Problems
   *       (Spring semester 2018)
   *       Chapter 3: The QR Algorithm
   *       http://people.inf.ethz.ch/arbenz/ewp/Lnotes/2010/chapter3.pdf 
   */
  const francis_qr = ( Q,Q_off,Q_stride, H_off ) =>
  {
    const h = (i,j) => H[H_off + N*i+j],
          is_zero = i => {
            if( Math.abs(h(i,i-1)) > TOL * ( Math.abs(h(i-1,i-1)) + Math.abs(h(i,i)) ) ) // <- goes to else on NaN
              return false;
            else {
              H[H_off + N*i+i-1] *= 0.0; // <- Handles NaN. If a value is that small, its digits are likely nonsense (due to cancellation error) so let's set it to zero.
              return true;
            }
          },
          /** Applies a two-sided given rotation.
           */
          giv = (i,j,c,s) => {
            if( j <= i ) throw new Error('Assertion failed.')
            // ROTATE ROWS IN H
            for( let k=Math.max(0,i-1); k < Q_stride; k++ )
            { const H_i = H[H_off + N*i+k],
                    H_j = H[H_off + N*j+k];
              H[H_off + N*i+k] = s*H_j + c*H_i;
              H[H_off + N*j+k] = c*H_j - s*H_i;
            }
            // ROTATE COLUMNS IN H
            for( let k=Math.min(Q_stride,j+2); k-- > 0; )
            { const H_i = H[H_off + N*k+i],
                    H_j = H[H_off + N*k+j];
              H[H_off + N*k+i] = s*H_j + c*H_i;
              H[H_off + N*k+j] = c*H_j - s*H_i;
            }
            // ROTATE ROWS IN Q
            for( let k=Q_stride; k-- > 0; )
            { const Q_i = Q[Q_off + Q_stride*i+k],
                    Q_j = Q[Q_off + Q_stride*j+k];
              Q[Q_off + Q_stride*i+k] = s*Q_j + c*Q_i;
              Q[Q_off + Q_stride*j+k] = c*Q_j - s*Q_i;
            }
          },
          /** Recursively performs the schur-decomposition of the sub-region [s,e).
           * 
           *  During iteration, the givens rotations are only applied to current
           *  subregion and are accumulated in a temporary matrix. Only after the
           *  Francis QR algorithm is done, the transformations are applied to 
           */
          recurse = (s,e) => {
            if( e-s > Q_stride>>>1 ) throw new Error('Assertion failed.'); // <- assert that memory is bounded by O(n)
            const n = e-s; if( n < 3 ) throw new Error('Assertion failed.');
            const q = new DTypeArray(n*n);
            // INIT q TO IDENTITY
            for( let i=0; i < n; i++ ) q[n*i+i] = 1.0;

            // RUN FRANCIS QR ON SUB-PROBLEM
            francis_qr(q,0,n, H_off + N*s+s );

            // TRANSPOSE q
            for( let i=0; i < n; i++ )
            for( let j=0; j < i; j++ ) { const q_ij = q[n*i+j]; q[n*i+j] = q[n*j+i]; q[n*j+i] = q_ij; }

            // APPLY q TO LEFT OF Q (Q' = q.T @ Q)
            for( let i=0; i < Q_stride; i++ ) // <- each column in Q
            { tmp.fill(0.0, 0,n);
              for( let j=0; j < n; j++ )
              for( let k=0; k < n; k++ ) tmp[k] += q[n*j+k] * Q[Q_off + Q_stride*(s+j)+i];

              for( let j=0; j < n; j++ ) Q[Q_off + Q_stride*(s+j)+i] = tmp[j];
            }
            // APPLY q TO LEFT OF H (H' = q.T @ H)
            for( let i=e; i < Q_stride; i++ ) // <- each column in H
              { tmp.fill(0.0, 0,n);
                for( let j=0; j < n; j++ )
                for( let k=0; k < n; k++ ) tmp[k] += q[n*j+k] * H[H_off + N*(s+j)+i];

                for( let j=0; j < n; j++ ) H[H_off + N*(s+j)+i] = tmp[j];
              }
            // APPLY q TO RIGHT H (H" = H' @ q)
            for( let i=0; i < s; i++ ) // <- each row in H
              { tmp.fill(0.0, 0,n);
                for( let j=0; j < n; j++ )
                for( let k=0; k < n; k++ ) tmp[k] += q[n*j+k] * H[H_off + N*i+(s+j)];

                for( let j=0; j < n; j++ ) H[H_off + N*i+(s+j)] = tmp[j];
              }
          };
    let stuck_o_meter = 0,
        start = 0,
          end = Q_stride,
          rng = new AleaRNG('nd.la.schur_qrfrancis_inplace');

    while(true)
    { // DETECT ZEROS ON THE SUB-DIAGONAL AND SHRINK WORK SIZE ACCORDINGLY
      for( let done=false; !done; )
      {
        if( end-start < 3 ) return;
        if( end-start < Q_stride>>>4 ) return recurse(start,end); // <- ZOOM IN IF SUBPROBLEM IS SMALL ENOUGH

        done = false;
             if( is_zero(start+1) ) start+=1; else if( is_zero(end-1) ) end-=1;
        else if( is_zero(start+2) ) start+=2; else if( is_zero(end-2) ) end-=2;
        else done = true;

        const mid = start+end >>> 1;
        for( let i=start+2; done && ++i < end-2; )
          if( is_zero(i) )
          { done = false;
            // RUN NESTED FRANCIS QR ON THE SMALLER OF THE TWO 
            if( i > mid ) { recurse(i,  end);   end=i; }
            else          { recurse(start,i); start=i; }
          }

        if( !done ) stuck_o_meter = 0;
      }
      stuck_o_meter += 1;

      // DETERMINE (DOUBLE) SHIFT FROM LOWER RIGHT 2x2 BLOCK
      let i = end-2,
          j = end-1,
          tr = h(i,i) + h(j,j),
          det= h(i,i) * h(j,j)  -  h(i,j) * h(j,i);

      // FOR REAL EIGENVALUES LETS USE THE ONE THAT'S CLOSER TO THE LOWER RIGHT ENTRY
      if( tr*tr > 4*det )
      { let sign = tr >= 0 ? +1.0 : -1.0,
            ev1  =       0.5 * (tr + sign*Math.sqrt(tr*tr - 4*det)),
            ev2  = det * 2.0 / (tr + sign*Math.sqrt(tr*tr - 4*det)); // <- Citardauq Formula
        // use the eigenvalue closer to A[j,j]
        // SEE: Bindel, Fall 2016, Matrix Computations (CS 6210)
        //      Notes for 2016-10-24
        //      https://www.cs.cornell.edu/~bindel/class/cs6210-f16/lec/2016-10-24.pdf
        if( Math.abs(h(j,j) - ev1) > Math.abs(h(j,j) - ev2) )
          ev1 = ev2;
        tr = ev1*2;
        det= ev1*ev1;
      }

      // IF WE'RE STUCK, LET'S WIGGLE LIKE A FISH ON LAND (... well except maybe that fella: https://www.youtube.com/watch?v=fJLCSsnhLFc)
      // SEE: NUMERICAL RECIPES Webnote No. 16, Rev. 1
      //      Description of the QR Algorithm for Hessenberg Matrices
      //      http://numerical.recipes/webnotes/nr3web16.pdf
      if( stuck_o_meter % 16 == 0 ) {
        if( stuck_o_meter > 1e9 ) throw new Error('Too many iterations for a single eigenvalue.');
        tr  = Math.abs(h(j,i)) + Math.abs(h(i,end-3))
        det = tr*tr
        tr *= rng.uniform(1.25, 1.75);
      }

      // FIRST COLUMN OF DOUBLE SHIFTED MATRIX (H-sI)*(H-conj(s)I) = H² - 2*Re(s)*H + |s|²I
          i = start+0;
          j = start+1;
      let k = start+2,
          a1 = h(i,i)* h(i,i) + h(i,j)*h(j,i) - tr*h(i,i) + det,
          a2 = h(j,i)*(h(i,i) + h(j,j)        - tr),
          a3 = h(j,i)* h(k,j);

      // APPLY "DOUBLE SHIFTED" GIVENS ROTATIONS
      for( let row=2; row-- > 0; j=k, a2=a3 )
        if( a2 != 0 )
        { const  [c,s,norm] = _giv_rot_qr(a1,a2);
          giv(i,j,c,s);
          a1 = norm;
//*DEBUG*/          if( !(Math.abs(c*a2 - s*a1) <= 1e-8) ) throw new Error('Assertion failed.')
        }

      // REINSTATE HESSENBERG PROPERTY
      for( let col=start; col < end-2; col++ )
      { i = col+1
        const J = Math.min(end,col+4);
        for( j=col+2; j < J; j++ )
        { const  H_i = h(i,col),
                 H_j = h(j,col);
          if(0===H_j) continue;
          const  [c,s,norm] = _giv_rot_qr(H_i,H_j);
          giv(i,j,c,s);
          H[H_off + N*j+col] *= 0.0; // <- handles NaN
//*DEBUG*/          if( !(Math.abs(h(j,col)) <= 1e-8) ) throw new Error('Assertion failed.')
        }
      }
    }
  }

  // BEGIN SCHUR DECOMPOSING MATRICES
  for( let off=0; off < Q.length; off += N*N )
  { // TRANSPOSE Q
    for( let i=0; i < N; i++ )
    for( let j=0; j < i; j++ ) { const Q_ij = Q[off + N*i+j]; Q[off + N*i+j]=Q[off + N*j+i]; Q[off + N*j+i] = Q_ij; }

    // RUN FRANCIS QR ALGORITHM
    francis_qr(Q,off,N, off);

    // BEGIN RESOLVE REAL-VALUED 2x2 BLOCKS
    for( let j=1; j < N; j++ )
    { const i = j-1;
      if( H[off + N*j+i] != 0 )
      { // The goal is to find a givens rotation that Schur-decomposes a real-eigenvalue 2x2 matrix.
        // ┌                ┐ ┌            ┐ ┌                ┐   ┌      ┐
        // │ cos(α) -sin(α) │ │ H_ii  H_ij │ │ cos(α) -sin(α) │ ! │ λ₁ p │
        // │                │ │            │ │                │ = │      │
        // │ sin(α)  cos(α) │ │ H_ji  H_jj │ │ sin(α)  cos(α) │   │ 0  λ₂│ => 0 == (H_ji⋅cos(α) - H_ii⋅sin(α))⋅cos(α) + (H_jj⋅cos(α) - H_ij⋅sin(α))⋅sin(α)
        // └                ┘ └            ┘ └                ┘   └      ┘ => 0 == (H_jj-H_ii)⋅sin(2⋅α) + (H_ij+H_ji)⋅cos(2⋅α) + H_ji-H_ij =: f(α)
        //
        // This brings us to a standard trigonometry equation:
        //   A*sin(x) + B*cos(x) = C
        // Where
        //   A = H_jj-H_ii
        //   B = H_ij+H_ji
        //   C = H_ij-H_ji
        //
        // Solution:
        //   x = 360° * n + 2*atan2( a ± sqrt(a² + b² - c²), b+c )
        //   (n=0)
        //     = 2*atan2( H_jj-H_ii + sqrt( (H_jj-H_ii)² + 4*H_ij*H_ji ), 2*H_ij )
        //
        // Another simple and very numerically accurate solution would be Binary Search. In order to do that, we have to bracket a solution. So let's determine the extrema of f(α).
        // 
        // f'(α_max) =!= 0 = 2*(H_jj-H_ii)⋅cos(2⋅α_max) - 2*(H_ij+H_ji)⋅sin(2⋅α_max) => α_max = atan2( H_jj-H_ii, H_ij+H_ji ) / 2 + n*π/2
        const H_ii = H[off+N*i+i], H_ij = H[off+N*i+j],
              H_ji = H[off+N*j+i], H_jj = H[off+N*j+j];

        // const α_min =         Math.atan2(H_jj-H_ii, H_ij+H_ji) / 2,
        //       α_max = α_min + Math.PI/2 * (α_min <= 0 ? +1 : -1),
        //       α = 0.5 * root1d_bisect(
        //         α => ( (H_ij+H_ji) * Math.cos(α)
        //              + (H_ji-H_ij)
        //              + (H_jj-H_ii) * Math.sin(α) ),
        //         2*α_min, 2*α_max
        //       ),
        //       c = Math.cos(α),
        //       s = Math.sin(α);

        const A = H_jj-H_ii,
            ABC = A*A + 4*H_ij*H_ji; // = A² + B² - C²
        if( ABC < 0 ) continue;

        const [c,s] = function(){
          if( 0===H_ij )
            return [0,1];
          const  T = A + (A < 0 ? -1 : +1)*Math.sqrt(ABC),
                 R = H_ij*2,        TR  =  Math.hypot(T,R), // α = atan2(T,R)
            s = (R < 0 ? -T : +T) / TR,
            c =       Math.abs(R) / TR;
          return [c,s];
        }();

        for( let k=i; k < N; k++ ) // ROTATE ROWS IN H
        { const H_i = H[off + N*i+k],
                H_j = H[off + N*j+k];
          H[off + N*i+k] = s*H_j + c*H_i;
          H[off + N*j+k] = c*H_j - s*H_i;
        }
        for( let k=j+1; k-- > 0; ) // ROTATE COLUMNS IN H
        { const H_i = H[off + N*k+i],
                H_j = H[off + N*k+j];
          H[off + N*k+i] = s*H_j + c*H_i;
          H[off + N*k+j] = c*H_j - s*H_i;
        }
        for( let k=N; k-- > 0; ) // ROTATE ROWS IN Q
        { const Q_i = Q[off + N*i+k],
                Q_j = Q[off + N*j+k];
          Q[off + N*i+k] = s*Q_j + c*Q_i;
          Q[off + N*j+k] = c*Q_j - s*Q_i;
        }
        H[off + N*j+i] *= 0.0; // <- Handles NaN. If a value is that small, its digits are likely nonsense (due to cancellation error) so let's set it to zero.
      }
    }
    // END RESOLVE REAL-VALUED 2x2 BLOCKS

    // TRANSPOSE Q BACK
    for( let i=0; i < N; i++ )
    for( let j=0; j < i; j++ ) { const Q_ij = Q[off + N*i+j]; Q[off + N*i+j]=Q[off + N*j+i]; Q[off + N*j+i] = Q_ij; }
  } // END SCHUR DECOMPOSING MATRICES
}// END schur_qrfrancis_inplace
