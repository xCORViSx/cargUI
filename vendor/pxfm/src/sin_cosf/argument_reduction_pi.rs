/*
 * // Copyright (c) Radzivon Bartoshyk 8/2025. All rights reserved.
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
use crate::round::RoundFinite;

#[derive(Debug, Copy, Clone)]
pub(crate) struct ArgumentReducerPi {
    pub(crate) x: f64,
}

impl ArgumentReducerPi {
    // Return k and y, where
    // k = round(x * 32 / pi) and y = (x * 32 / pi) - k.
    #[inline]
    pub(crate) fn reduce(self) -> (f64, i64) {
        let kd = (self.x * 32.).round_finite();
        let y = f_fmla(self.x, 32.0, -kd);
        (y, unsafe {
            kd.to_int_unchecked::<i64>() // indeterminate values is always filtered out before this call, as well only lowest bits are used
        })
    }

    // Return k and y, where
    // k = round(x * 2 / pi) and y = (x * 2 / pi) - k.
    #[inline]
    pub(crate) fn reduce_0p25(self) -> (f64, i64) {
        let kd = (self.x + self.x).round_finite();
        let y = f_fmla(kd, -0.5, self.x);
        (y, unsafe {
            kd.to_int_unchecked::<i64>() // indeterminate values is always filtered out before this call, as well only lowest bits are used
        })
    }
    //
    // // Return k and y, where
    // // k = round(x * 2 / pi) and y = (x * 2 / pi) - k.
    // #[inline]
    // pub(crate) fn reduce_0p10(self) -> (f64, i64) {
    //     let kd = (self.x * 4.).round();
    //     let y = f_fmla(kd, -0.25, self.x);
    //     (y, kd as i64)
    // }
}
