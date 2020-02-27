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

import {forEachItemIn, CUSTOM_MATCHERS} from '../jasmine_utils'
import {array, asarray, NDArray} from '../nd_array'
import {tabulate} from '../tabulate'
import {zip_elems} from '../zip_elems'

import {norm} from '../la/norm'

import {fit_lm_gen} from './lm'
import {num_grad} from './num_grad'


describe('levenberg-marquardt', () => {
  beforeEach( () => {
    jasmine.addMatchers(CUSTOM_MATCHERS)
  })


  forEachItemIn(
    function*(){
      for( const opt of [
        undefined,
        { lambda0: 0                    },
        {              lambdaFactor: 1  },
        { lambda0: 0,  lambdaFactor: 1  },
        { lambda0: 1,  lambdaFactor: 1  },

        { lambda0: 0,  lambdaFactor: 1.1},
        { lambda0: 0.1,lambdaFactor: 1.7},
        {              lambdaFactor: 1.3},
        { lambda0: 2.2                  }
      ])
        for( let run=3; run-- > 0; )
        {
          const                            N = Math.random()*4 + 1 | 0,
                        coeffs = tabulate([N], () => Math.random()*4 - 2);
          Object.freeze(coeffs)
          Object.freeze(coeffs.data.buffer)
          yield    [opt,coeffs];
        }
    }()
  ).it(`fit_lm_gen fits coefficients of polynomial.`, ([opt,coeffs]) => {

    const [N] = coeffs.shape;

    const [f,g] = [
      p => x => p.reduce( (sum,p,i) => sum + p * x**i ),
      p => x => p.map( (p,i) => x**i )
    ].map( f => {
      expect(f).toEqual( jasmine.any(Function) );

      return p => {
        expect(p).toEqual( jasmine.any(NDArray) );
        expect(p.shape).toEqual(coeffs.shape);

        const fp = f(p.data);

        return x => {
          expect(x).toEqual( jasmine.any(NDArray) );
          expect(x.shape).toEqual( Int32Array.of(1) );

          return fp(x.data[0]);
        };
      };
    });

    const fg = p => {
      const fp = f(p),
            gp = g(p);
      return x => [ fp(x), gp(x) ];
    };
    

    ;{      
      const h = p => x => num_grad( p => f(p)(x) )(p);

      for( let repeat=128; repeat-- > 0; )
      {
        const x = array([ Math.random()*4 - 2 ]),
              p = tabulate([N], 'float64', () => Math.random()*4 - 2);
        expect( g(p)(x) ).toBeAllCloseTo( h(p)(x) );
      }
    };

    const M = 256;

    const x = tabulate([M,1], 'float64', () => Math.random()*8 - 4),
          y = new NDArray(
            Int32Array.of(M),
            x.data.map(
              x => f(coeffs)( array([x]) )
            )
          );
    Object.freeze(x);
    Object.freeze(y);
    Object.freeze(x.data.buffer);
    Object.freeze(y.data.buffer);

    const computeRes = p =>       x.data.map( (x,i) => f(p)( array([x]) ) - y(i) ),
          computeErr = p => 0.5 * x.data.reduce( (sum,x,i) => sum + (f(p)( array([x]) ) - y(i))**2 / M, 0 ),
          computeGrad= num_grad(computeErr);

    let nIter = 0,
        mse,
        grad,
        param,
        res;

    for( [mse, grad, param, res] of fit_lm_gen(
      x,y, fg, tabulate([N], () => Math.random()*4 - 2), opt
    ))
    {
      expect(++nIter).toBeLessThan(64);

      expect(mse ).toBeAllCloseTo( computeErr (param) );
      expect(grad).toBeAllCloseTo( computeGrad(param), {rtol: 1e-3} );
      expect(res ).toBeAllCloseTo( computeRes (param) );

      if( norm(grad) <= Math.sqrt(M)*1e-12 )
        break;
    }

    if( opt != null && 'lambda0' in opt && opt.lambda0 === 0 )
      expect(nIter).toBe(2);
    expect(param).toBeAllCloseTo(coeffs);
  })


  forEachItemIn(
    function*(){
      for( let run=3; run-- > 0; )
        for( const opt of [
          undefined,
          { lambda0: Math.random()*2                                   },
          {                           lambdaFactor: Math.random()+1.01 },
          { lambda0: Math.random()*2, lambdaFactor: Math.random()+1.01 }
        ])
        {
          const                            N = Math.random()*4 + 1 | 0,
                        coeffs = tabulate([N], () => Math.random()*4 - 2);
          Object.freeze(coeffs)
          Object.freeze(coeffs.data.buffer)
          yield    [opt,coeffs];
        }
    }()
  ).it('fit_lm_gen fits coefficients of polynomial in root form.', ([opt,coeffs]) => {

    const [N] = coeffs.shape;

    const [f,g] = [
      p => x => p.reduce( (prod,p) => prod*(p-x), 1 ),
      p => x => p.map(
        (_,i) => p.reduce( (prod,p,j) => i===j ? prod : prod*(p-x), 1 )
      )
    ].map( f => {
      expect(f).toEqual( jasmine.any(Function) );

      return p => {
        expect(p).toEqual( jasmine.any(NDArray) );
        expect(p.shape).toEqual(coeffs.shape);

        const fp = f(p.data);

        return x => {
          expect(x).toEqual( jasmine.any(NDArray) );
          expect(x.shape).toEqual( Int32Array.of(1) );

          return fp(x.data[0]);
        };
      };
    });

    const fg = p => {
      const fp = f(p),
            gp = g(p);
      return x => [ fp(x), gp(x) ];
    };
    

    // check gradient
    ;{      
      const h = p => x => num_grad( p => f(p)(x) )(p);

      for( let repeat=64; repeat-- > 0; )
      {
        const x = array([ Math.random()*4 - 2 ]),
              p = tabulate([N], 'float64', () => Math.random()*4 - 2);
        expect( g(p)(x) ).toBeAllCloseTo( h(p)(x) );
      }
    };

    const M = 128;

    const x = tabulate([M,1], 'float64', () => Math.random()*8 - 4),
          y = new NDArray(
            Int32Array.of(M),
            x.data.map(
              x => f(coeffs)( array([x]) )
            )
          );
    Object.freeze(x);
    Object.freeze(y);
    Object.freeze(x.data.buffer);
    Object.freeze(y.data.buffer);

    const computeRes = p =>       x.data.map(        (x,i) =>        f(p)( array([x]) ) - y(i) ),
          computeErr = p => 0.5 * x.data.reduce( (sum,x,i) => sum + (f(p)( array([x]) ) - y(i))**2 / M, 0 ),
          computeGrad= num_grad(computeErr);

    let nIter = 0,
        mse,
        grad,
        param,
        res;

    for( [mse, grad, param, res] of fit_lm_gen(
      x,y, fg, tabulate([N], () => Math.random()*4 - 2), opt
    ))
    {
      expect(++nIter).toBeLessThan(512);

      expect(mse ).toBeAllCloseTo( computeErr (param) );
      expect(grad).toBeAllCloseTo( computeGrad(param), {rtol: 1e-3} );
      expect(res ).toBeAllCloseTo( computeRes (param) );

      if( norm(grad) <= Math.sqrt(M)*1e-12 )
        break;
    }

    const par =  param.data.slice().sort( (x,y) => x-y ),
          coe = coeffs.data.slice().sort( (x,y) => x-y );

    expect(par).toBeAllCloseTo(coe);
  })


  forEachItemIn(
    function*(){
      for( let run=24; run-- > 0; )
      {
        const         coeffs = tabulate([2], () => Math.random()*4 - 2);
        Object.freeze(coeffs);
        Object.freeze(coeffs.data.buffer);
        yield         coeffs;
      }
    }()
  ).it('fit_lm_gen fits scaled exponential function.', coeffs => {

    expect( coeffs.shape ).toEqual( Int32Array.of(2) );

    const [f,g] = [
      ([a,b]) => x => a * Math.exp(b*x),
      ([a,b]) => x => [Math.exp(b*x), a*x * Math.exp(b*x)]
    ].map( f => {
      expect(f).toEqual( jasmine.any(Function) );

      return p => {
        expect(p).toEqual( jasmine.any(NDArray) );
        expect(p.shape).toEqual( Int32Array.of(2) );

        const fp = f(p.data);

        return x => {
          expect(x).toEqual( jasmine.any(NDArray) );
          expect(x.shape).toEqual( Int32Array.of(1) );

          return fp(x.data[0]);
        };
      };
    });

    const fg = p => {
      const fp = f(p),
            gp = g(p);
      return x => [ fp(x), gp(x) ];
    };

    ;{      
      const h = p => x => num_grad( p => f(p)(x) )(p);

      for( let repeat=128; repeat-- > 0; )
      {
        const x = array([ Math.random()*4 - 2 ]),
              p = tabulate([2], 'float64', () => Math.random()*4 - 2);
        expect( g(p)(x) ).toBeAllCloseTo( h(p)(x) );
      }
    };

    const M = 128;

    const x = tabulate([M,1], 'float64', () => Math.random()*6 - 3),
          y = new NDArray(
            Int32Array.of(M),
            x.data.map(
              x => f(coeffs)( array([x]) )
            )
          );
    Object.freeze(x);
    Object.freeze(y);
    Object.freeze(x.data.buffer);
    Object.freeze(y.data.buffer);

    const computeRes = p =>       x.data.map(        (x,i) =>        f(p)( array([x]) ) - y(i) ),
          computeErr = p => 0.5 * x.data.reduce( (sum,x,i) => sum + (f(p)( array([x]) ) - y(i))**2 / M, 0 ),
          computeGrad= num_grad(computeErr);

    let nIter = 0,
        mse,
        grad,
        param,
        res;

    for( [mse, grad, param, res] of fit_lm_gen(
      x,y, fg, coeffs.mapElems( x => x + Math.random()*3 - 1.5 )
    ))
    {
      expect(++nIter).toBeLessThan(512);

      if( ! isFinite(mse) )
        console.log({coeffs, param, mse, grad})

      expect(mse ).toBeAllCloseTo( computeErr (param) );
      expect(grad).toBeAllCloseTo( computeGrad(param), {rtol: 1e-3, atol:1e-5} );
      expect(res ).toBeAllCloseTo( computeRes (param) );

      if( norm(grad) <= Math.sqrt(M)*1e-12 )
        break;
    }
    expect(param).toBeAllCloseTo(coeffs);
  })
})