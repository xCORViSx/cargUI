/*
 * // Copyright (c) Radzivon Bartoshyk 6/2025. All rights reserved.
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
use crate::conversions::katana::KatanaInitialStage;
use crate::conversions::katana::md3x3::MultidimensionalDirection;
use crate::conversions::katana::md4x3::{execute_matrix_stage3, execute_simple_curves3};
use crate::conversions::md_lut::{
    MultidimensionalLut, NVector, linear_1i_vec3f, linear_2i_vec3f_direct, linear_3i_vec3f_direct,
    linear_4i_vec3f, linear_5i_vec3f, linear_6i_vec3f, linear_7i_vec3f, linear_8i_vec3f,
    linear_9i_vec3f, linear_10i_vec3f, linear_11i_vec3f, linear_12i_vec3f, linear_13i_vec3f,
    linear_14i_vec3f, linear_15i_vec3f,
};
use crate::safe_math::SafeMul;
use crate::trc::lut_interp_linear_float;
use crate::{
    CmsError, DataColorSpace, Layout, LutMultidimensionalType, MalformedSize, Matrix3d, Matrix3f,
    PointeeSizeExpressible, TransformOptions, Vector3d, Vector3f,
};
use num_traits::AsPrimitive;
use std::marker::PhantomData;

struct MultidimensionalNx3<
    T: Copy + Default + AsPrimitive<f32> + PointeeSizeExpressible + Send + Sync,
    const BIT_DEPTH: usize,
> {
    a_curves: Option<Vec<Vec<f32>>>,
    m_curves: Option<Box<[Vec<f32>; 3]>>,
    b_curves: Option<Box<[Vec<f32>; 3]>>,
    clut: Option<Vec<f32>>,
    matrix: Matrix3f,
    bias: Vector3f,
    direction: MultidimensionalDirection,
    grid_size: [u8; 16],
    input_inks: usize,
    _phantom: PhantomData<T>,
}

#[inline(never)]
pub(crate) fn interpolate_out_function(
    layout: Layout,
) -> fn(lut: &MultidimensionalLut, arr: &[f32], inputs: &[f32]) -> NVector<f32, 3> {
    const OUT: usize = 3;
    match layout {
        Layout::Rgb => linear_3i_vec3f_direct::<OUT>,
        Layout::Rgba => linear_4i_vec3f::<OUT>,
        Layout::Gray => linear_1i_vec3f::<OUT>,
        Layout::GrayAlpha => linear_2i_vec3f_direct::<OUT>,
        Layout::Inks5 => linear_5i_vec3f::<OUT>,
        Layout::Inks6 => linear_6i_vec3f::<OUT>,
        Layout::Inks7 => linear_7i_vec3f::<OUT>,
        Layout::Inks8 => linear_8i_vec3f::<OUT>,
        Layout::Inks9 => linear_9i_vec3f::<OUT>,
        Layout::Inks10 => linear_10i_vec3f::<OUT>,
        Layout::Inks11 => linear_11i_vec3f::<OUT>,
        Layout::Inks12 => linear_12i_vec3f::<OUT>,
        Layout::Inks13 => linear_13i_vec3f::<OUT>,
        Layout::Inks14 => linear_14i_vec3f::<OUT>,
        Layout::Inks15 => linear_15i_vec3f::<OUT>,
    }
}

impl<
    T: Copy + Default + AsPrimitive<f32> + PointeeSizeExpressible + Send + Sync,
    const BIT_DEPTH: usize,
> MultidimensionalNx3<T, BIT_DEPTH>
{
    fn to_pcs_impl(&self, input: &[T], dst: &mut [f32]) -> Result<(), CmsError> {
        let norm_value = if T::FINITE {
            1.0 / ((1u32 << BIT_DEPTH) - 1) as f32
        } else {
            1.0
        };
        assert_eq!(
            self.direction,
            MultidimensionalDirection::DeviceToPcs,
            "PCS to device cannot be used on `to pcs` stage"
        );

        // A -> B
        // OR B - A A - curves stage

        if let (Some(a_curves), Some(clut)) = (self.a_curves.as_ref(), self.clut.as_ref()) {
            let layout = Layout::from_inks(self.input_inks);

            let mut inks = vec![0.; self.input_inks];

            if clut.is_empty() {
                return Err(CmsError::InvalidAtoBLut);
            }

            let fetcher = interpolate_out_function(layout);

            let md_lut = MultidimensionalLut::new(self.grid_size, self.input_inks, 3);

            for (src, dst) in input
                .chunks_exact(layout.channels())
                .zip(dst.chunks_exact_mut(3))
            {
                for ((ink, src_ink), curve) in inks.iter_mut().zip(src).zip(a_curves.iter()) {
                    *ink = lut_interp_linear_float(src_ink.as_() * norm_value, curve);
                }

                let interpolated = fetcher(&md_lut, clut, &inks);

                dst[0] = interpolated.v[0];
                dst[1] = interpolated.v[1];
                dst[2] = interpolated.v[2];
            }
        } else {
            return Err(CmsError::InvalidAtoBLut);
        }

        // Matrix stage

        if let Some(m_curves) = self.m_curves.as_ref() {
            execute_simple_curves3(dst, m_curves);
            execute_matrix_stage3(self.matrix, self.bias, dst);
        }

        // B-curves is mandatory
        if let Some(b_curves) = &self.b_curves.as_ref() {
            execute_simple_curves3(dst, b_curves);
        }

        Ok(())
    }
}

impl<
    T: Copy + Default + AsPrimitive<f32> + PointeeSizeExpressible + Send + Sync,
    const BIT_DEPTH: usize,
> KatanaInitialStage<f32, T> for MultidimensionalNx3<T, BIT_DEPTH>
{
    fn to_pcs(&self, input: &[T]) -> Result<Vec<f32>, CmsError> {
        if input.len() % self.input_inks != 0 {
            return Err(CmsError::LaneMultipleOfChannels);
        }

        let mut new_dst = vec![0f32; (input.len() / self.input_inks) * 3];

        self.to_pcs_impl(input, &mut new_dst)?;
        Ok(new_dst)
    }
}

fn make_multidimensional_nx3<
    T: Copy + Default + AsPrimitive<f32> + PointeeSizeExpressible + Send + Sync,
    const BIT_DEPTH: usize,
>(
    mab: &LutMultidimensionalType,
    _: TransformOptions,
    _: DataColorSpace,
    direction: MultidimensionalDirection,
) -> Result<MultidimensionalNx3<T, BIT_DEPTH>, CmsError> {
    if mab.num_output_channels != 3 {
        return Err(CmsError::UnsupportedProfileConnection);
    }
    if mab.b_curves.is_empty() || mab.b_curves.len() != 3 {
        return Err(CmsError::InvalidAtoBLut);
    }

    let clut: Option<Vec<f32>> =
        if mab.a_curves.len() == mab.num_input_channels as usize && mab.clut.is_some() {
            let clut = mab.clut.as_ref().map(|x| x.to_clut_f32()).unwrap();
            let mut lut_grid = 1usize;
            for grid in mab.grid_points.iter().take(mab.num_input_channels as usize) {
                lut_grid = lut_grid.safe_mul(*grid as usize)?;
            }
            let lut_grid = lut_grid.safe_mul(mab.num_output_channels as usize)?;
            if clut.len() != lut_grid {
                return Err(CmsError::MalformedCurveLutTable(MalformedSize {
                    size: clut.len(),
                    expected: lut_grid,
                }));
            }
            Some(clut)
        } else {
            return Err(CmsError::InvalidAtoBLut);
        };

    let a_curves: Option<Vec<Vec<f32>>> =
        if mab.a_curves.len() == mab.num_input_channels as usize && mab.clut.is_some() {
            let mut arr = Vec::new();
            for a_curve in mab.a_curves.iter() {
                arr.push(a_curve.to_clut()?);
            }
            Some(arr)
        } else {
            None
        };

    let b_curves: Option<Box<[Vec<f32>; 3]>> = if mab.b_curves.len() == 3 {
        let mut arr = Box::<[Vec<f32>; 3]>::default();
        let all_curves_linear = mab.b_curves.iter().all(|curve| curve.is_linear());
        if all_curves_linear {
            None
        } else {
            for (c_curve, dst) in mab.b_curves.iter().zip(arr.iter_mut()) {
                *dst = c_curve.to_clut()?;
            }
            Some(arr)
        }
    } else {
        return Err(CmsError::InvalidAtoBLut);
    };

    let matrix = mab.matrix.to_f32();

    let m_curves: Option<Box<[Vec<f32>; 3]>> = if mab.m_curves.len() == 3 {
        let all_curves_linear = mab.m_curves.iter().all(|curve| curve.is_linear());
        if !all_curves_linear
            || !mab.matrix.test_equality(Matrix3d::IDENTITY)
            || mab.bias.ne(&Vector3d::default())
        {
            let mut arr = Box::<[Vec<f32>; 3]>::default();
            for (curve, dst) in mab.m_curves.iter().zip(arr.iter_mut()) {
                *dst = curve.to_clut()?;
            }
            Some(arr)
        } else {
            None
        }
    } else {
        None
    };

    let bias = mab.bias.cast();

    let transform = MultidimensionalNx3::<T, BIT_DEPTH> {
        a_curves,
        b_curves,
        m_curves,
        matrix,
        direction,
        clut,
        grid_size: mab.grid_points,
        bias,
        input_inks: mab.num_input_channels as usize,
        _phantom: PhantomData,
    };

    Ok(transform)
}

pub(crate) fn katana_multi_dimensional_nx3_to_pcs<
    T: Copy + Default + AsPrimitive<f32> + PointeeSizeExpressible + Send + Sync,
    const BIT_DEPTH: usize,
>(
    src_layout: Layout,
    mab: &LutMultidimensionalType,
    options: TransformOptions,
    pcs: DataColorSpace,
) -> Result<Box<dyn KatanaInitialStage<f32, T> + Send + Sync>, CmsError> {
    if pcs == DataColorSpace::Rgb {
        if mab.num_input_channels != 3 {
            return Err(CmsError::InvalidAtoBLut);
        }
        if src_layout != Layout::Rgba && src_layout != Layout::Rgb {
            return Err(CmsError::InvalidInksCountForProfile);
        }
    } else if mab.num_input_channels != src_layout.channels() as u8 {
        return Err(CmsError::InvalidInksCountForProfile);
    }
    let transform = make_multidimensional_nx3::<T, BIT_DEPTH>(
        mab,
        options,
        pcs,
        MultidimensionalDirection::DeviceToPcs,
    )?;
    Ok(Box::new(transform))
}
