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

import {albaali_fletcher} from './albaali_fletcher'
import {generic_test_line_search        } from './_generic_test_line_search'
import {generic_test_line_search_bounded} from './_generic_test_line_search_bounded'


generic_test_line_search_bounded( albaali_fletcher() );
generic_test_line_search_bounded( albaali_fletcher({fRed: 0.2           }) );
generic_test_line_search_bounded( albaali_fletcher({           gRed: 0.7}) );
generic_test_line_search_bounded( albaali_fletcher({fRed: 0.4, gRed: 0.6}) );


generic_test_line_search( albaali_fletcher() );
generic_test_line_search( albaali_fletcher({fRed: 0.2          }) );
generic_test_line_search( albaali_fletcher({           gRed: 0.7}) );
generic_test_line_search( albaali_fletcher({fRed: 0.4, gRed: 0.6}) );
