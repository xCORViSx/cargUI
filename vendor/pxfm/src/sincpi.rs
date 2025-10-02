/*
 * // Copyright (c) Radzivon Bartoshyk 9/2025. All rights reserved.
 * //
 * // Redistribution and use in source and binary forms, with or without modification,
 * // are permitted provided that the following conditions are met:
 * //
 * // 1.  Redistributions of source code must retain the above copyright notice, this
 * // list of conditions and the following disclaimer.
 * //
 * // 2.  Redistributions in binary form must reproduce the above copyright notice,
 * // this list of conditions and the following disclaimer in the documentation
 * // and/or other materials provided with the distribution.
 * //
 * // 3.  Neither the name of the copyright holder nor the names of its
 * // contributors may be used to endorse or promote products derived from
 * // this software without specific prior written permission.
 * //
 * // THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * // AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * // IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * // DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
 * // FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * // DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * // SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
 * // CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * // OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * // OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
use crate::common::f_fmla;
use crate::double_double::DoubleDouble;
use crate::polyeval::f_estrin_polyeval5;
use crate::sincospi::reduce_pi_64;
use crate::sincospi_tables::SINPI_K_PI_OVER_64;

/**
Sinpi on range [0.0, 0.03515625]

Generated poly by Sollya:
```text
d = [0, 0.03515625];
f_sincpi = sin(y*pi)/(y*pi);
Q = fpminimax(f_sincpi, [|0, 2, 4, 6, 8, 10, 12|], [|107...|], d, relative, floating);
```
See ./notes/sincpi_at_zero_dd.sollya
**/
#[cold]
fn as_sincpi_zero(x: f64) -> f64 {
    const C: [(u64, u64); 7] = [
        (0xb9d3080000000000, 0x3ff0000000000000),
        (0xbc81873d86314302, 0xbffa51a6625307d3),
        (0x3c84871b4ffeefae, 0x3fe9f9cb402bc46c),
        (0xbc5562d6ae037010, 0xbfc86a8e4720db66),
        (0xbc386c93f4549bac, 0x3f9ac6805cf31ffd),
        (0x3c0dbda368edfa40, 0xbf633816a3399d4e),
        (0xbbcf22ccc18f27a9, 0x3f23736e6a59edd9),
    ];
    let x2 = DoubleDouble::from_exact_mult(x, x);
    let mut p = DoubleDouble::quick_mul_add(
        x2,
        DoubleDouble::from_bit_pair(C[6]),
        DoubleDouble::from_bit_pair(C[5]),
    );
    p = DoubleDouble::quick_mul_add(x2, p, DoubleDouble::from_bit_pair(C[4]));
    p = DoubleDouble::quick_mul_add(x2, p, DoubleDouble::from_bit_pair(C[3]));
    p = DoubleDouble::quick_mul_add(x2, p, DoubleDouble::from_bit_pair(C[2]));
    p = DoubleDouble::quick_mul_add(x2, p, DoubleDouble::from_bit_pair(C[1]));
    p = DoubleDouble::quick_mul_add(x2, p, DoubleDouble::from_bit_pair(C[0]));
    p.to_f64()
}

/// Computes sin(PI\*x)/(PI\*x)
///
/// Produces normalized sinc.
///
/// Max ULP 0.5
pub fn f_sincpi(x: f64) -> f64 {
    let ix = x.to_bits();
    let ax = ix & 0x7fff_ffff_ffff_ffff;
    if ax == 0 {
        return 1.;
    }
    let e: i32 = (ax >> 52) as i32;
    let m0 = (ix & 0x000fffffffffffff) | (1u64 << 52);
    let sgn: i64 = (ix as i64) >> 63;
    let m = ((m0 as i64) ^ sgn).wrapping_sub(sgn);
    let mut s: i32 = 1063i32.wrapping_sub(e);
    if s < 0 {
        if e == 0x7ff {
            if (ix << 12) == 0 {
                return f64::NAN;
            }
            return x + x; // case x=NaN
        }
        s = -s - 1;
        if s > 10 {
            return f64::copysign(0.0, x);
        }
        let iq: u64 = (m as u64).wrapping_shl(s as u32);
        if (iq & 2047) == 0 {
            return f64::copysign(0.0, x);
        }
    }

    if ax <= 0x3fa2000000000000u64 {
        // |x| <= 0.03515625

        if ax < 0x3c90000000000000u64 {
            // |x| < f64::EPSILON
            if ax <= 0x3b05798ee2308c3au64 {
                // |x| <= 2.2204460492503131e-24
                return 1.;
            }
            // Small values approximated with Taylor poly
            // sincpi(x) ~ 1 - x^2*Pi^2/6 + O(x^4)
            #[cfg(any(
                all(
                    any(target_arch = "x86", target_arch = "x86_64"),
                    target_feature = "fma"
                ),
                all(target_arch = "aarch64", target_feature = "neon")
            ))]
            {
                const M_SQR_PI_OVER_6: f64 = f64::from_bits(0xbffa51a6625307d3);
                let p = f_fmla(x, M_SQR_PI_OVER_6 * x, 1.);
                return p;
            }
            #[cfg(not(any(
                all(
                    any(target_arch = "x86", target_arch = "x86_64"),
                    target_feature = "fma"
                ),
                all(target_arch = "aarch64", target_feature = "neon")
            )))]
            {
                use crate::common::min_normal_f64;
                return 1. - min_normal_f64();
            }
        }

        // Poly generated by Sollya:
        // d = [0, 0.03515625];
        // f_sincpi = sin(y*pi)/(y*pi);
        // Q = fpminimax(f_sincpi, [|0, 2, 4, 6, 8, 10|], [|107, D...|], d, relative, floating);
        // See ./notes/sincpi_at_zero.sollya

        let x2 = x * x;

        let eps = x * f_fmla(
            x2,
            f64::from_bits(0x3d00000000000000), // 2^-47
            f64::from_bits(0x3bd0000000000000), // 2^-66
        );

        const C: [u64; 5] = [
            0xbffa51a6625307d3,
            0x3fe9f9cb402bbeaa,
            0xbfc86a8e466bbb5b,
            0x3f9ac66d887e2f38,
            0xbf628473a38d289a,
        ];

        const F: DoubleDouble =
            DoubleDouble::from_bit_pair((0xbb93f0a925810000, 0x3ff0000000000000));

        let p = f_estrin_polyeval5(
            x2,
            f64::from_bits(C[0]),
            f64::from_bits(C[1]),
            f64::from_bits(C[2]),
            f64::from_bits(C[3]),
            f64::from_bits(C[4]),
        );
        let v = DoubleDouble::from_exact_mult(p, x2);
        let z = DoubleDouble::add(F, v);

        let lb = z.hi + (z.lo - eps);
        let ub = z.hi + (z.lo + eps);
        if lb == ub {
            return lb;
        }
        return as_sincpi_zero(x);
    }

    let si = e.wrapping_sub(1011);
    if si >= 0 && (m0.wrapping_shl(si.wrapping_add(1) as u32)) == 0 {
        // x is integer or half-integer
        if (m0.wrapping_shl(si as u32)) == 0 {
            return f64::copysign(0.0, x); // x is integer
        }
        let t = (m0.wrapping_shl((si - 1) as u32)) >> 63;
        // t = 0 if |x| = 1/2 mod 2, t = 1 if |x| = 3/2 mod 2
        #[cfg(any(
            all(
                any(target_arch = "x86", target_arch = "x86_64"),
                target_feature = "fma"
            ),
            all(target_arch = "aarch64", target_feature = "neon")
        ))]
        {
            let num = if t == 0 {
                f64::copysign(1.0, x)
            } else {
                -f64::copysign(1.0, x)
            };
            const PI: DoubleDouble =
                DoubleDouble::from_bit_pair((0x3ca1a62633145c07, 0x400921fb54442d18));
            let r = DoubleDouble::quick_mult_f64(PI, x);
            let v = DoubleDouble::from_f64_div_dd(num, r);
            return v.to_f64();
        }

        #[cfg(not(any(
            all(
                any(target_arch = "x86", target_arch = "x86_64"),
                target_feature = "fma"
            ),
            all(target_arch = "aarch64", target_feature = "neon")
        )))]
        {
            use crate::double_double::two_product_compatible;
            if two_product_compatible(x) {
                let num = if t == 0 {
                    f64::copysign(1.0, x)
                } else {
                    -f64::copysign(1.0, x)
                };
                const PI: DoubleDouble =
                    DoubleDouble::from_bit_pair((0x3ca1a62633145c07, 0x400921fb54442d18));
                let r = DoubleDouble::quick_mult_f64(PI, x);
                let v = DoubleDouble::from_f64_div_dd(num, r);
                return v.to_f64();
            } else {
                use crate::dyadic_float::{DyadicFloat128, DyadicSign};
                let num = DyadicFloat128::new_from_f64(if t == 0 {
                    f64::copysign(1.0, x)
                } else {
                    -f64::copysign(1.0, x)
                });
                const PI: DyadicFloat128 = DyadicFloat128 {
                    sign: DyadicSign::Pos,
                    exponent: -126,
                    mantissa: 0xc90fdaa2_2168c234_c4c6628b_80dc1cd1_u128,
                };
                let dx = DyadicFloat128::new_from_f64(x);
                let r = (PI * dx).reciprocal();
                return (num * r).fast_as_f64();
            }
        }
    }

    let (y, k) = reduce_pi_64(x);

    // cos(k * pi/64) = sin(k * pi/64 + pi/2) = sin((k + 32) * pi/64).
    let sin_k = DoubleDouble::from_bit_pair(SINPI_K_PI_OVER_64[((k as u64) & 127) as usize]);
    let cos_k = DoubleDouble::from_bit_pair(
        SINPI_K_PI_OVER_64[((k as u64).wrapping_add(32) & 127) as usize],
    );

    let r_sincos = crate::sincospi::sincospi_eval(y);

    const PI: DoubleDouble = DoubleDouble::from_bit_pair((0x3ca1a62633145c07, 0x400921fb54442d18));
    let scale = DoubleDouble::quick_mult_f64(PI, x);

    let sin_k_cos_y = DoubleDouble::quick_mult(sin_k, r_sincos.v_cos);
    let cos_k_sin_y = DoubleDouble::quick_mult(cos_k, r_sincos.v_sin);

    // sin_k_cos_y is always >> cos_k_sin_y
    let mut rr = DoubleDouble::from_exact_add(sin_k_cos_y.hi, cos_k_sin_y.hi);
    rr.lo += sin_k_cos_y.lo + cos_k_sin_y.lo;
    rr = DoubleDouble::div(rr, scale);

    let ub = rr.hi + (rr.lo + r_sincos.err); // (rr.lo + ERR);
    let lb = rr.hi + (rr.lo - r_sincos.err); // (rr.lo - ERR);

    if ub == lb {
        return rr.to_f64();
    }
    sincpi_dd(y, sin_k, cos_k, scale)
}

#[cold]
fn sincpi_dd(x: f64, sin_k: DoubleDouble, cos_k: DoubleDouble, scale: DoubleDouble) -> f64 {
    let r_sincos = crate::sincospi::sincospi_eval_dd(x);
    let cos_k_sin_y = DoubleDouble::quick_mult(cos_k, r_sincos.v_sin);
    let mut rr = DoubleDouble::mul_add(sin_k, r_sincos.v_cos, cos_k_sin_y);
    rr = DoubleDouble::div(rr, scale);
    rr.to_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sincpi_zero() {
        assert_eq!(f_sincpi(2.2204460492503131e-24), 1.0);
        assert_eq!(f_sincpi(f64::EPSILON), 1.0);
        assert_eq!(f_sincpi(0.007080019335262543), 0.9999175469662566);
        assert_eq!(f_sincpi(0.05468860710998057), 0.9950875152844803);
        assert_eq!(f_sincpi(0.5231231231), 0.6068750737806441);
        assert_eq!(f_sincpi(1.), 0.);
        assert_eq!(f_sincpi(-1.), 0.);
        assert_eq!(f_sincpi(-2.), 0.);
        assert_eq!(f_sincpi(-3.), 0.);
        assert!(f_sincpi(f64::INFINITY).is_nan());
        assert!(f_sincpi(f64::NEG_INFINITY).is_nan());
        assert!(f_sincpi(f64::NAN).is_nan());
    }
}
