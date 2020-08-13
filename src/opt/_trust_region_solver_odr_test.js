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

import {concat} from "../concat";
import {forEachItemIn, CUSTOM_MATCHERS} from '../jasmine_utils'
import {array, NDArray} from "../nd_array";
import {rand_normal} from "../rand_normal";
import {tabulate} from "../tabulate";
import {_rand_int,
        _rand_rankdef} from "../_test_data_generators";
import {zip_elems} from '../zip_elems';

import {matmul2} from "../la/matmul";
import {qr_decomp} from "../la/qr";
import {svd_lstsq} from "../la/svd";
import {svd_jac_2sided} from "../la/svd_jac_2sided";

import {num_grad} from "./num_grad";
import {TrustRegionSolverLSQ} from "./_trust_region_solver_lsq";
import {TrustRegionSolverODR   } from "./_trust_region_solver_odr";
import {TrustRegionSolverODR_NY} from "./_trust_region_solver_odr_ny";


const funcs = {
  lin1d: {
    NP: 2,
    NX: 1,
    NDIM: 2,
    f:   ([a,b]) => ([x]) => a + b*x,
    fgg: ([a,b]) => ([x]) => {
      const f = a + b*x,
           gp = array('float64', [1,x]),
           gx = array('float64', [b]);
      return [f,gp,gx];
    }
  },
  lin2d: {
    NP: 3,
    NX: 2,
    NDIM: 2,
    f:   ([a,b,c]) => ([x,y]) => a + b*x + c*y,
    fgg: ([a,b,c]) => ([x,y]) => {
      const f = a + b*x + c*y,
           gp = array('float64', [1,x,y]),
           gx = array('float64', [b,c]);
      return [f,gp,gx];
    }
  },
  lin3d: {
    NP: 4,
    NX: 3,
    NDIM: 2,
    f:   ([a,b,c,d]) => ([x,y,z]) => a + b*x + c*y + d*z,
    fgg: ([a,b,c,d]) => ([x,y,z]) => {
      const f = a + b*x + c*y + d*z,
           gp = array('float64', [1,x,y,z]),
           gx = array('float64', [b,c,d]);
      return [f,gp,gx];
    }
  },
  sigmoid: {
    NP: 4,
    NX: 1,
    NDIM: 1,
    f:   ([a,b,c,d]) => x => a + b / (1 + Math.exp(c - d*x)),
    fgg: ([a,b,c,d]) => x => {
      const exp = Math.exp(c - d*x),
              f = a + b / (1 + exp),
             gp = array('float64', [
               1,
               1   / (1+exp),
                -b / (1/exp + exp + 2),
               x*b / (1/exp + exp + 2)
             ]),
             gx = array('float64', d*b / (1/exp + exp + 2));
      return [f,gp,gx];
    }
  },
  poly2d: {
    NP: 6,
    NX: 2,
    NDIM: 2,
    f:   ([a,b,c,d,e,f]) => ([x,y]) => a + b*x + c*y + d*x*x + e*y*y + f*x*y,
    fgg: ([a,b,c,d,e,f]) => ([x,y]) => {
      const F = a + b*x + c*y + d*x*x + e*y*y + f*x*y,
           gp = array('float64', [1, x, y, x*x, y*y, x*y]),
           gx = array('float64', [
             b + 2*d*x + f*y,
             c + 2*e*y + f*x
           ]);
      return [F,gp,gx];
    }
  }
};
Object.freeze(funcs);

const PROTOS = [
  TrustRegionSolverODR_NY,
  TrustRegionSolverODR,
];

for( const TrustRegionSolverODR of PROTOS )
for( const [name,{NP,NX,NDIM,f,fgg}] of Object.entries(funcs) )
  describe(`${TrustRegionSolverODR.name} [test_fn: ${name}]`, () => {
    beforeEach( () => {
      jasmine.addMatchers(CUSTOM_MATCHERS)
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 24*1024; )
          yield [
            tabulate([NP],                 'float64', () => Math.random()*4 - 2),
            tabulate([NX].slice(0,NDIM-1), 'float64', () => Math.random()*4 - 2)
          ];
      }()
    ).it(`test_fn derivatives are correct`, ([p, x]) => {
      const GP = num_grad( p => f(p)(x) )(p),
            GX = num_grad( x => f(p)(x) )(x);

      const [F,gp,gx] = fgg(p)(x);

      expect(F).toBeAllCloseTo(f(p)(x), {rtol: 0.0, atol: 0.0});
      expect(gp).toBeAllCloseTo(GP);
      expect(gx).toBeAllCloseTo(GX);
    })


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 512; )
        {
          const MX = _rand_int(1,16),
            shape = [MX,NX].slice(0,NDIM),
                p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
              dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial report is correct given random examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const DY = (p,dx) => {
        const xdx = zip_elems([x,dx], (x,dx) => x+dx);
        return tabulate( y.shape, 'float64', i => f(p)(xdx.sliceElems(i)) - y(i) );
      };

      const loss = (p,dx) => {
        const  dy = DY(p,dx),
                M = dx.data.length +
                    dy.data.length;
        return dx.data.reduce( (loss,r) => loss + r*r/M, 0.0 ) +
               dy.data.reduce( (loss,r) => loss + r*r/M, 0.0 );
      };

      const ztol = {atol:0, rtol:0};

      expect(solver.loss).toBeAllCloseTo(solver.report_loss);
      expect(solver.loss).toBeAllCloseTo( loss(p0,dx0) );

      expect(solver.report_p ).toBeAllCloseTo( p0, ztol);
      expect(solver.report_dx).toBeAllCloseTo(dx0, ztol);
      expect(solver.report_dy).toBeAllCloseTo( DY(p0,dx0) );

      const dloss_dp  = num_grad( p => loss(p ,dx0) )( p0),
            dloss_ddx = num_grad(dx => loss(p0,dx ) )(dx0);

      expect(solver.report_dloss_dp ).toBeAllCloseTo(dloss_dp , {atol: 1e-6});
      expect(solver.report_dloss_ddx).toBeAllCloseTo(dloss_ddx, {atol: 1e-6});

      const [
        report_p,
        report_dx,
        report_loss,
        report_dloss_dp,
        report_dloss_ddx,
        report_dy
      ] = solver.report();

      expect(report_loss).toBeAllCloseTo(solver.loss);
      expect(report_loss).toBeAllCloseTo( loss(p0,dx0) );

      expect(report_p ).toBeAllCloseTo( p0, ztol);
      expect(report_dx).toBeAllCloseTo(dx0, ztol);
      expect(report_dy).toBeAllCloseTo( DY(p0,dx0) );

      expect(report_dloss_dp ).toBeAllCloseTo(dloss_dp , {atol: 1e-6});
      expect(report_dloss_ddx).toBeAllCloseTo(dloss_ddx, {atol: 1e-6});
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,16),
            shape = [MX,NX].slice(0,NDIM),
                p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
              dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial X0,F0,G0,D,J is correct given random examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const                            X0 = concat([dx0.reshape(-1), p0]);
      expect(solver.X0).toBeAllCloseTo(X0);

      const F = X => {
        const p = array('float64', X.data.slice(-NP)),
             dx = new NDArray(x.shape, X.data.slice(0,-NP)),
            xdx = zip_elems([x,dx], 'float64', (x,dx) => x+dx),
             dy = tabulate(y.shape, 'float64', i => f(p)(xdx.sliceElems(i)) - y(i));

        return concat([dx.reshape(-1), dy]);
      };

      const                            F0 = F(X0);
      expect(solver.F0).toBeAllCloseTo(F0);

      const         loss = x => F(x).data.reduce((loss,r) => loss + r*r/2, 0.0);
      expect(solver.loss).toBeAllCloseTo( loss(X0) / F0.shape[0] * 2 );

      expect(solver.G0).toBeAllCloseTo(num_grad(loss)(X0), {atol:1e-6});

      const {M,N} = solver,                        J = tabulate([M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j)),
                    G0 = matmul2(F0.reshape(1,-1), J);
      expect(solver.G0).toBeAllCloseTo(G0);

      const D = J.reduceElems(0, 'float64', (x,y) => Math.hypot(x,y));
      expect(solver.D).toBeAllCloseTo(D);
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 512; )
        {
          const MX = _rand_int(1,16),
            shape = [MX,NX].slice(0,NDIM),
                p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
              dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          function* seq() {
            for( let step=0; step++ < 8; )
              yield Float64Array.from({length: MX*NX+NP}, () => Math.random()*2e-3 - 1e-3);
          }

          yield [x,y, p0,dx0, seq()]
        }
      }()
    ).it(`considerMove(dX) returns correct loss and loss prediction`, ([x, y, p0, dx0, seq]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const                            X0 = concat([dx0.reshape(-1), p0]);
      expect(solver.X0).toBeAllCloseTo(X0);

      const F = X => {
        const p = array('float64', X.data.slice(-NP)),
             dx = new NDArray(x.shape, X.data.slice(0,-NP)),
            xdx = zip_elems([x,dx], 'float64', (x,dx) => x+dx),
             dy = tabulate(y.shape, 'float64', i => f(p)(xdx.sliceElems(i)) - y(i));

        return concat([dx.reshape(-1), dy]);
      };

      const                            F0 = F(X0);
      expect(solver.F0).toBeAllCloseTo(F0);

      const [len] = F0.shape;

      const         loss = x => F(x).data.reduce((loss,r) => loss + r*r/len, 0.0);
      expect(solver.loss).toBeAllCloseTo( loss(X0) );

      for( const dX of seq ) {
        const X1 = X0.mapElems((x0,i) => x0+dX[i]),
          loss1 = loss(X1);

        const [ loss_predict,
                loss_new ] = solver.considerMove(dX);

        expect(loss_new    ).toBeAllCloseTo(loss1);
        expect(loss_predict).toBeAllCloseTo(loss1, {atol: 1e-6});
        // expect(solver.loss).toBeAllCloseTo(loss1, {atol: 1e-6}); // <- should fail (counter sample)
      }

      const         G0 = num_grad( dX => solver.considerMove(dX.data)[0] * len / 2 )( new Float64Array(X0.shape[0]) );
      expect(solver.G0).toBeAllCloseTo(G0, {atol: 1e-6});
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,64),
            shape = [MX,NX].slice(0,NDIM),
                p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
              dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`cauchyTravel() finds min. along gradient direction`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const g = num_grad( cp => {
        const                                      dx = solver.G0.map( g => g*cp ),
              [loss_predict] = solver.considerMove(dx);
        return loss_predict;
      });

      const  cp = solver.cauchyTravel();
      expect(cp).toBeLessThanOrEqual(0);

      expect( g(cp) ).toBeAllCloseTo(0, {atol: 1e-7});
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(NP,64), // <- TODO: replace with `_rand_int(1,64)` after rank-deficient implementation is finished
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() QR decomposes sparse part of J correctly given random examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; )
        solver.J11[i] = 0.1 + Math.random()*1.8;

      for( let i=MX*NX; i-- > 0; )
        solver.J21[i] = Math.random()*4 - 2;

      for( let i=MX*NP; i-- > 0; )
        solver.J22[i] = Math.random()*4 - 2;

      for( let i=M; i-- > 0; )
        solver.F0[i] = Math.random()*4 - 2;

      const J = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) );

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const J1 = tabulate( [M,    MX*NX], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
            R1 = tabulate( [MX*NX,MX*NX], 'float64', (i,j) => solver.__DEBUG_R(i,j) ),
            QF = new NDArray( Int32Array.of(MX*NX,1), solver.QF.slice(0,MX*NX) );

      const [Q,r1] = qr_decomp(J1);

      expect(R1).toBeAllCloseTo(r1);
      expect(QF).toBeAllCloseTo( matmul2(Q.T, F) ); // <- TODO only first (MX*NX) rows should be checked
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 3*512; )
        {
          const MX = _rand_int(NP,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated over-determined examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; )
        solver.J11[i] = 0.1 + Math.random()*1.8;

      for( let i=MX*NX; i-- > 0; )
        solver.J21[i] = Math.random()*4 - 2;

      for( let i=MX*NP; i-- > 0; )
        solver.J22[i] = Math.random()*4 - 2;

      for( let i=M; i-- > 0; )
        solver.F0[i] = Math.random()*4 - 2;

      const J = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) );

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const  X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() );
      expect(X).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(J),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,64),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated random examples with J21=0`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = 0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4 - 2;
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J  = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() ),
            JD = zip_elems([J,D.T], (j,d) => d===0 ? j : j/d);

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      expect(solver.rank).toBe( Math.min(M,N) );

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const   X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() ),
             DX = zip_elems([D,X], (d,x) => d===0 ? x : d*x );
      expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,64),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated random rank-deficient examples with J21=0`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      const [{data: J22},rnk] = _rand_rankdef(MX,NP);
      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = 0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = J22[i];
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J  = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() ),
            JD = zip_elems([J,D.T], (j,d) => d===0 ? j : j/d);

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      expect(solver.rank).toBe(MX*NX + rnk);

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const   X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() ),
              DX = zip_elems([D,X], (d,x) => d===0 ? x : d*x );
      expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 3*512; )
        {
          const MX = _rand_int(1,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated random examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4 - 2;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4 - 2;
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J  = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() ),
            JD = zip_elems([J,D.T], (j,d) => d===0 ? j : j/d);

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      expect(solver.rank).toBe( Math.min(M,N) );

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const   X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() ),
             DX = zip_elems([D,X], (d,x) => d===0 ? x : d*x );
      expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 2*1024; )
        {
          const MX = _rand_int(1,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated random rank-deficient examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      const [{data: J22},rnk] = _rand_rankdef(MX,NP);

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4 - 2;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = J22[i];
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J  = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() ),
            JD = zip_elems([J,D.T], (j,d) => d===0 ? j : j/d);

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      expect(solver.rank).toBe(MX*NX + rnk);

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const   X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() ),
             DX = zip_elems([D,X], (d,x) => d===0 ? x : d*x );
      expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 3*512; )
        {
          const MX = _rand_int(1,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0]
        }
      }()
    ).it(`initial computeNewton() solves generated random sparse examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] =(Math.random()*4 - 2) * (Math.random() < 0.95);
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] =(Math.random()*4 - 2) * (Math.random() < 0.95);
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J  = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() ),
            JD = zip_elems([J,D.T], (j,d) => d===0 ? j : j/d);

      const              F_shape = Int32Array.of(M,1),
        F = new NDArray( F_shape, solver.F0.slice() );

      solver.computeNewton();

      // check that J,F is unmodified by computeNewton
      expect(J).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
      expect(F).toBeAllCloseTo(  new NDArray( F_shape, solver.F0.slice() ) );

      const   X = new NDArray( Int32Array.of(N,1), solver.newton_dX.slice() ),
             DX = zip_elems([D,X], (d,x) => d===0 ? x : d*x );
      expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F).mapElems('float64', x => -x) );
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,16),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          const lambdas = Array.from({length: 6}, () => Math.random()*2);
          lambdas[_rand_int(0,lambdas.length)] = 0;
          lambdas[_rand_int(0,lambdas.length)] = 0;
          Object.freeze(lambdas);

          yield [x,y, p0,dx0, lambdas];
        }
      }()
    ).it(`computeNewtonRegularized(λ) solves generated random examples`, ([x, y, p0, dx0, lambdas]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4 - 2;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4 - 2;
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J1 = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() );

      const               F_shape = Int32Array.of(M,1),
        F1 = new NDArray( F_shape, solver.F0.slice() );

      for( const λ of lambdas )
      {
        const λSqrt = Math.sqrt(λ);

        solver.computeNewtonRegularized(λ);

        const X = new NDArray( Int32Array.of(N,1), solver.regularized_dX.slice() );

        // check that J,F is unmodified by computeNewton
        expect(J1).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
        expect(F1).toBeAllCloseTo( new NDArray( F_shape, solver.F0.slice() ) );
        expect( D).toBeAllCloseTo( new NDArray( Int32Array.of(N,1), solver.D.slice() ) );

        if( 0 === λ )
        {
          const  JD = zip_elems([J1,D.T], (j,d) => d===0 ? j : j/d),
                 DX = zip_elems([D ,X  ], (d,x) => d===0 ? x : d*x);
          expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F1).mapElems('float64', x => -x) );
        }
        else
        {
          const J2 = tabulate( [N,N], 'float64', (i,j) => i!==j ? 0 : (D(i,0)*λSqrt || 1) ),
                F2 = tabulate( [N,1], 'float64',    () => 0 ),
                J = concat([J1,J2]),
                F = concat([F1,F2]);

          const  X = new NDArray( Int32Array.of(N,1), solver.regularized_dX.slice() );
          expect(X).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(J),F).mapElems('float64', x => -x) );
        }
      }
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,16),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          const lambdas = Array.from({length: 6}, () => Math.random()*2);
          lambdas[_rand_int(0,lambdas.length)] = 0;
          lambdas[_rand_int(0,lambdas.length)] = 0;
          Object.freeze(lambdas);

          yield [x,y, p0,dx0, lambdas];
        }
      }()
    ).it(`computeNewtonRegularized(λ) solves generated random rank-deficient examples`, ([x, y, p0, dx0, lambdas]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0),
          {M,N,MX} = solver;

      const [{data: J22}] = _rand_rankdef(MX,NP);
      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4 - 2;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = J22[i];
      for( let i=M    ; i-- > 0; ) solver. F0[i] = Math.random()*4 - 2;
      for( let i=N    ; i-- > 0; ) solver.  D[i] =(Math.random() < 0.99 || i < MX*NX) * (0.01 + Math.random()*2);

      const J1 = tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ),
             D = new NDArray( Int32Array.of(N,1), solver.D.slice() );

      const               F_shape = Int32Array.of(M,1),
        F1 = new NDArray( F_shape, solver.F0.slice() );

      for( const λ of lambdas )
      {
        const λSqrt = Math.sqrt(λ);

        solver.computeNewtonRegularized(λ);

        const X = new NDArray( Int32Array.of(N,1), solver.regularized_dX.slice() );

        // check that J,F is unmodified by computeNewton
        expect(J1).toBeAllCloseTo( tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) ), {rtol:0, atol:0} );
        expect(F1).toBeAllCloseTo( new NDArray( F_shape, solver.F0.slice() ) );
        expect( D).toBeAllCloseTo( new NDArray( Int32Array.of(N,1), solver.D.slice() ) );

        if( 0 === λ )
        {
          const  JD = zip_elems([J1,D.T], (j,d) => d===0 ? j : j/d),
                 DX = zip_elems([D ,X  ], (d,x) => d===0 ? x : d*x);
          expect(DX).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(JD),F1).mapElems('float64', x => -x) );
        }
        else
        {
          const J2 = tabulate( [N,N], 'float64', (i,j) => i!==j ? 0 : (D(i,0)*λSqrt || 1) ),
                F2 = tabulate( [N,1], 'float64',    () => 0 ),
                J = concat([J1,J2]),
                F = concat([F1,F2]);

          const  X = new NDArray( Int32Array.of(N,1), solver.regularized_dX.slice() );
          expect(X).toBeAllCloseTo( svd_lstsq(...svd_jac_2sided(J),F).mapElems('float64', x => -x) );
        }
      }
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 4096; )
        {
          const MX = _rand_int(NP,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0];
        }
      }()
    ).it(`computeNewtonRegularized(0) returns correct [r,dr] given random over-determined examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4.0 - 2.0;
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      const [r,dr] =    solver.computeNewtonRegularized(0);
      const [R,DR] = reference.computeNewtonRegularized(0);

      expect(solver.newton_dX).toBeAllCloseTo(reference.newton_dX);
      expect( r).toBeAllCloseTo( R);
      expect(dr).toBeAllCloseTo(DR);
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 4096; )
        {
          const MX = _rand_int(1,NP),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0];
        }
      }()
    ).it(`computeNewtonRegularized(0) returns correct [r,dr] given random under-determined examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4.0 - 2.0;
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      const [r,dr] =    solver.computeNewtonRegularized(0);
      const [R,DR] = reference.computeNewtonRegularized(0);

      expect(solver.newton_dX).toBeAllCloseTo(reference.newton_dX);
      expect( r).toBeAllCloseTo( R);
      expect(dr).toBeAllCloseTo(DR);
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          yield [x,y, p0,dx0];
        }
      }()
    ).it(`computeNewtonRegularized(0) returns correct [r,dr] given random rank-deficient examples`, ([x, y, p0, dx0]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      const [{data: J22},rnk] = _rand_rankdef(MX,NP);
      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = J22[i];
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      const [r,dr] =    solver.computeNewtonRegularized(0);
      const [R,DR] = reference.computeNewtonRegularized(0);

      expect(solver.newton_dX).toBeAllCloseTo(reference.newton_dX);
      expect( r).toBeAllCloseTo( R);
      expect(dr).toBeAllCloseTo(DR);
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 4096; )
        {
          const MX = _rand_int(NP,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          const lambdas = Array.from({length: 6}, () => Math.random()*2);
          lambdas[_rand_int(0,lambdas.length)] = 0;
          lambdas[_rand_int(0,lambdas.length)] = 0;
          Object.freeze(lambdas);

          yield [x,y, p0,dx0, lambdas];
        }
      }()
    ).it(`computeNewtonRegularized(λ) returns correct [r,dr] given random over-determined examples`, ([x, y, p0, dx0, lambdas]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4.0 - 2.0;
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      for( const λ of lambdas )
      {
        const [r,dr] =    solver.computeNewtonRegularized(λ);
        const [R,DR] = reference.computeNewtonRegularized(λ);

        if( 0 === λ )
        expect(solver.     newton_dX).toBeAllCloseTo(reference.     newton_dX);
        expect(solver.regularized_dX).toBeAllCloseTo(reference.regularized_dX);
        expect( r).toBeAllCloseTo( R);
        expect(dr).toBeAllCloseTo(DR);
      }
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 4096; )
        {
          const MX = _rand_int(1,NP),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          const lambdas = Array.from({length: 6}, () => Math.random()*2);
          lambdas[_rand_int(0,lambdas.length)] = 0;
          lambdas[_rand_int(0,lambdas.length)] = 0;
          Object.freeze(lambdas);

          yield [x,y, p0,dx0, lambdas];
        }
      }()
    ).it(`computeNewtonRegularized(λ) returns correct [r,dr] given random under-determined examples`, ([x, y, p0, dx0, lambdas]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = Math.random()*4.0 - 2.0;
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      for( const λ of lambdas )
      {
        const [r,dr] =    solver.computeNewtonRegularized(λ);
        const [R,DR] = reference.computeNewtonRegularized(λ);

        if( 0 === λ )
        expect(solver.     newton_dX).toBeAllCloseTo(reference.     newton_dX);
        expect(solver.regularized_dX).toBeAllCloseTo(reference.regularized_dX);
        expect( r).toBeAllCloseTo( R);
        expect(dr).toBeAllCloseTo(DR);
      }
    });


    forEachItemIn(
      function*(){
        for( let run=0; run++ < 1024; )
        {
          const MX = _rand_int(1,32),
             shape = [MX,NX].slice(0,NDIM),
                 p = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
                p0 = tabulate( [NP], 'float64', () => Math.random()*4 - 2),
               dx0 = tabulate(shape, 'float64', () => Math.random()*4 - 2);

          let x = tabulate(shape, 'float64', () => Math.random()*8 - 4),
              y = tabulate([MX],  'float64',  i => f(p)(x.sliceElems(i)) );

          x = x.mapElems('float64', x => x + rand_normal() / 8 );
          y = y.mapElems('float64', y => y + rand_normal() / 8 );

          const lambdas = Array.from({length: 6}, () => Math.random()*2);
          lambdas[_rand_int(0,lambdas.length)] = 0;
          lambdas[_rand_int(0,lambdas.length)] = 0;
          Object.freeze(lambdas);

          yield [x,y, p0,dx0, lambdas];
        }
      }()
    ).it(`computeNewtonRegularized(λ) returns correct [r,dr] given random rank-deficient examples`, ([x, y, p0, dx0, lambdas]) => {
      const solver = new TrustRegionSolverODR(x,y, fgg, p0,dx0);

      const {M,N,MX} = solver;

      const [{data: J22},rnk] = _rand_rankdef(MX,NP);
      for( let i=MX*NX; i-- > 0; ) solver.J11[i] = Math.random()*1.8 + 0.1;
      for( let i=MX*NX; i-- > 0; ) solver.J21[i] = Math.random()*4.0 - 2.0;
      for( let i=MX*NP; i-- > 0; ) solver.J22[i] = J22[i];
      for( let i=M    ; i-- > 0; ) solver.F0 [i] = Math.random()*4.0 - 2.0;
      for( let i=N    ; i-- > 0; ) solver.D  [i] = Math.random()*1.8 + 0.1;

      const fJ = x => [
        new NDArray(Int32Array.of(M), solver.F0.slice()),
        tabulate( [M,N], 'float64', (i,j) => solver.__DEBUG_J(i,j) )
      ];

      const x0 = new NDArray(Int32Array.of(N), solver.X0.slice());

      const reference = new TrustRegionSolverLSQ(fJ,x0);
      reference.D.set(solver.D);

      for( const λ of lambdas )
      {
        const [r,dr] =    solver.computeNewtonRegularized(λ);
        const [R,DR] = reference.computeNewtonRegularized(λ);

        if( 0 === λ )
        expect(solver.     newton_dX).toBeAllCloseTo(reference.     newton_dX);
        expect(solver.regularized_dX).toBeAllCloseTo(reference.regularized_dX);
        expect( r).toBeAllCloseTo( R);
        expect(dr).toBeAllCloseTo(DR);
      }
    });
  });
