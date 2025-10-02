#[test]
#[cfg(unix)]
fn unit_fds() {
    use zvariant::{serialized::Context, to_bytes, BE};

    #[macro_use]
    mod common {
        include!("common.rs");
    }

    let ctxt = Context::new_dbus(BE, 0);
    let encoded = to_bytes(ctxt, &()).unwrap();
    assert_eq!(encoded.len(), 0, "invalid encoding using `to_bytes`");
    let _: () = encoded
        .deserialize()
        .expect("invalid decoding using `from_slice`")
        .0;
}
