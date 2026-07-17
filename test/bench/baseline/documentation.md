# Working with Arrays in TypeScript

TypeScript arrays inherit from the built-in `Array` type. The snippet below shows the two most common ways to create and type an array.

```ts
const numbers: number[] = [1, 2, 3];
const generic: Array<string> = ['a', 'b'];
numbers.push(4);
```

Use `readonly` to prevent mutation when handing an array to a consumer that should not change it.

```ts
function first(xs: readonly number[]): number | undefined {
  return xs[0];
}
```

## Mapping and filtering

The instance methods `map` and `filter` return new arrays, leaving the original untouched.