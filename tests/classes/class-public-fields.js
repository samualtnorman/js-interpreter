test("basic functionality", () => {
    class A {
        number = 3;

        string = "foo";

        uninitialized;
    }

    const a = new A();
    expect(a.number).toBe(3);
    expect(a.string).toBe("foo");
    expect(a.uninitialized).toBeUndefined();
});

test("extended name syntax", () => {
    class A {
        "field with space" = 1;

        12 = "twelve";

        [`he${"llo"}`] = 3;
    }

    const a = new A();
    expect(a["field with space"]).toBe(1);
    expect(a[12]).toBe("twelve");
    expect(a.hello).toBe(3);
});

test("initializer has correct this value", () => {
    class A {
        this_val = this;

        this_name = this.this_val;
    }

    const a = new A();
    expect(a.this_val).toBe(a);
    expect(a.this_name).toBe(a);
});

test("static fields", () => {
    class A {
        static simple = 1;
        simple = 2;

        static "with space" = 3;

        static 24 = "two dozen";

        static [`he${"llo"}`] = "friends";

        static this_val = this;
        static this_name = this.name;
        static this_val2 = this.this_val;
    }

    expect(A.simple).toBe(1);
    expect(A["with space"]).toBe(3);
    expect(A[24]).toBe("two dozen");
    expect(A.hello).toBe("friends");

    expect(A.this_val).toBe(A);
    expect(A.this_name).toBe("A");
    expect(A.this_val2).toBe(A);

    const a = new A();
    expect(a.simple).toBe(2);
});

test("with super class", () => {
    class A {
        super_field = 3;
    }

    class B extends A {
        references_super_field = super.super_field;
        arrow_ref_super = () => (super.super_field = 4);
    }

    const b = new B();
    expect(b.super_field).toBe(3);
    expect(b.references_super_field).toBeUndefined();
    b.arrow_ref_super();
    expect(b.super_field).toBe(4);
});
