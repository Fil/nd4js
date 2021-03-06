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


export function binary_rangesearch( from, until, compass_fn )
{
  if( !(from <= until) )
    throw new Error('binary_rangesearch(from, until, compass_fn): from must not be greater than until.');

  until -= 1;
  while( from <= until )
  {
    const mid = (from+until) >>> 1,
            c = compass_fn(mid);
         if(c < 0)  from = mid+1;
    else if(c > 0) until = mid-1;
    else return mid;
  }
  return ~from;
}


export function binary_search( array, key, compare_fn = (x,y) => (x>y) - (x<y) )
{
  let from = 0,
        to = array.length-1;

  while( from <= to )
  {
    const mid = (from+to) >>> 1,
            c = compare_fn(array[mid], key);
         if(c < 0) from = mid+1;
    else if(c > 0)   to = mid-1;
    else return mid;
  }
  return ~from;
}

