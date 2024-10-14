import { parse } from "@babel/parser"
import type { Node } from "@babel/types"
import * as babel from "@babel/types"
import { assert, AssertError } from "@samual/lib/assert"

const enum SignalType {
	Return, Break, Continue
}

export type Context = {
	variables: Record<string, unknown>
	constants: Record<string, unknown>
	statementLabel: string | undefined
	this: any
	callSuper: ((...args: any) => any) | undefined
	getSuperProperty: ((name: string) => any) | undefined

	signal: {
		type: SignalType.Break | SignalType.Continue
		label: string | undefined
	} | {
		type: SignalType.Return
		value: any
	} | undefined
}

export function evaluate(code: string, variables = Object.create(globalThis)) {
	return run(parse(code), {
		variables,
		constants: Object.create(null),
		statementLabel: undefined,
		this: undefined,
		callSuper: undefined,
		getSuperProperty: undefined,
		signal: undefined
	})
}

export function run(node: Node, context: Context): any {
	switch (node.type) {
		case `Program`: {
			hoist(node.body, context)

			let finalValue

			for (const childNode of node.body)
				finalValue = run(childNode, context)

			return finalValue
		}

		case `VariableDeclaration`: {
			const variableMap = node.kind == `var` || node.kind == `let`
				? context.variables
				: context.constants

			for (const childNode of node.declarations) {
				assert(childNode.type == `VariableDeclarator`, `childNode.type was not "VariableDeclarator"`)

				const { id, init } = childNode

				assert(id.type == `Identifier`, `id.type was not "Identifier"`)
				// TODO maybe `context.variables` should just store the type of variable
				delete context.constants[id.name]

				variableMap[id.name] = init
					? (init.type == `FunctionExpression`
						? createFunction(init, context, id.name)
						: run(init, context)
					)
					: undefined
			}

			return
		}

		case `ExpressionStatement`: {
			return run(node.expression, context)
		}

		case `CallExpression`: {
			const args = []

			for (const argument of node.arguments) {
				if (argument.type == `SpreadElement`)
					args.push(...run(argument.argument, context))
				else
					args.push(run(argument, context))
			}

			if (node.callee.type == `Super`) {
				if (context.callSuper)
					return context.callSuper(...args)

				throw new TypeError(`must call super in class constructor`)
			}

			if (node.callee.type != `MemberExpression`)
				return run(node.callee, context)(...args)

			if (node.callee.object.type == `Super`) {
				if (!context.getSuperProperty)
					throw new TypeError(`must call super in class constructor`)

				if (node.callee.computed)
					return context.getSuperProperty(run(node.callee.property, context)).call(context.this, ...args)

				assert(node.callee.property.type == `Identifier`, `node.callee.property.type was "${node.callee.property.type}"`)

				return context.getSuperProperty(node.callee.property.name).call(context.this, ...args)
			}

			const object = run(node.callee.object, context)

			if (node.callee.computed)
				return object[run(node.callee.property, context)](...args)

			assert(node.callee.property.type == `Identifier`, `node.callee.property.type was "${node.callee.property.type}"`)

			if (typeof object[node.callee.property.name] == `function`)
				return object[node.callee.property.name](...args)

			throw new TypeError(`property "${node.callee.property.name}" is not a function`)
		}

		case `MemberExpression`: {
			const object = run(node.object, context)

			if (node.property.type == `Identifier` && !node.computed)
				return object[node.property.name]

			return object[run(node.property, context)]
		}

		case `Identifier`:
			return getVariable(node.name, context)

		case `FunctionDeclaration`:
		case `EmptyStatement`:
			return

		case `FunctionExpression`: {
			if (node.id) {
				assert(node.id.type == `Identifier`, `node.id.type was "${node.id.type}"`)

				return createFunction(node, context, node.id.name)
			}

			return createFunction(node, context)
		}

		case `ArrowFunctionExpression`:
			return createFunction(node, context)

		case `ForStatement`: {
			const forContext = scopeContext(context)
			let finalValue

			for (node.init ? run(node.init, forContext) : undefined; node.test ? run(node.test, forContext) : true; node.update ? run(node.update, forContext) : undefined) {
				finalValue = run(node.body, forContext)

				if (!forContext.signal)
					continue

				if (forContext.signal.type == SignalType.Break) {
					if (forContext.signal.label)
						context.signal = forContext.signal

					return finalValue
				}

				if (forContext.signal.type == SignalType.Continue) {
					if (forContext.signal.label && forContext.signal.label != forContext.statementLabel) {
						context.signal = forContext.signal

						return finalValue
					}

					forContext.signal = undefined
				}
			}

			return finalValue
		}

		case `AssignmentExpression`: {
			if (node.left.type == `Identifier`) {
				let left: any = getVariable(node.left.name, context)

				switch (node.operator) {
					case `=`:
						return setVariable(node.left.name, left = run(node.right, context), context)

					case `*=`:
						return setVariable(node.left.name, left *= run(node.right, context), context)

					case `**=`:
						return setVariable(node.left.name, left **= run(node.right, context), context)

					case `/=`:
						return setVariable(node.left.name, left /= run(node.right, context), context)

					case `%=`:
						return setVariable(node.left.name, left %= run(node.right, context), context)

					case `+=`:
						return setVariable(node.left.name, left += run(node.right, context), context)

					case `-=`:
						return setVariable(node.left.name, left -= run(node.right, context), context)

					case `<<=`:
						return setVariable(node.left.name, left <<= run(node.right, context), context)

					case `>>=`:
						return setVariable(node.left.name, left >>= run(node.right, context), context)

					case `>>>=`:
						return setVariable(node.left.name, left >>>= run(node.right, context), context)

					case `&=`:
						return setVariable(node.left.name, left &= run(node.right, context), context)

					case `^=`:
						return setVariable(node.left.name, left ^= run(node.right, context), context)

					case `|=`:
						return setVariable(node.left.name, left |= run(node.right, context), context)

					case `&&=`:
						return setVariable(node.left.name, left &&= run(node.right, context), context)

					case `||=`:
						return setVariable(node.left.name, left ||= run(node.right, context), context)

					case `??=`:
						return setVariable(node.left.name, left ??= run(node.right, context), context)
				}

				throw new Error(`Unhandled operator: ${node.operator}`)
			}

			assert(node.left.type == `MemberExpression`, () => `node.left.type was "${node.left.type}"`)

			const object: any = run(node.left.object, context)

			const key = node.left.property.type == `Identifier` && !node.left.computed
				? node.left.property.name
				: run(node.left.property, context)

			switch (node.operator) {
				case `=`:
					return object[key] = run(node.right, context)

				case `*=`:
					return object[key] *= run(node.right, context)

				case `**=`:
					return object[key] **= run(node.right, context)

				case `/=`:
					return object[key] /= run(node.right, context)

				case `%=`:
					return object[key] %= run(node.right, context)

				case `+=`:
					return object[key] += run(node.right, context)

				case `-=`:
					return object[key] -= run(node.right, context)

				case `<<=`:
					return object[key] <<= run(node.right, context)

				case `>>=`:
					return object[key] >>= run(node.right, context)

				case `>>>=`:
					return object[key] >>>= run(node.right, context)

				case `&=`:
					return object[key] &= run(node.right, context)

				case `^=`:
					return object[key] ^= run(node.right, context)

				case `|=`:
					return object[key] |= run(node.right, context)

				case `&&=`:
					return object[key] &&= run(node.right, context)

				case `||=`:
					return object[key] ||= run(node.right, context)

				case `??=`:
					return object[key] ??= run(node.right, context)
			}

			throw new Error(`Unhandled operator: ${node.operator}`)
		}

		case `BinaryExpression`: {
			switch (node.operator) {
				case `+`:
					return run(node.left, context) + run(node.right, context)

				case `-`:
					return run(node.left, context) - run(node.right, context)

				case `/`:
					return run(node.left, context) / run(node.right, context)

				case `*`:
					return run(node.left, context) * run(node.right, context)

				case `%`:
					return run(node.left, context) % run(node.right, context)

				case `**`:
					return run(node.left, context) ** run(node.right, context)

				case `in`:
					return run(node.left, context) in run(node.right, context)

				case `instanceof`:
					return run(node.left, context) instanceof run(node.right, context)

				case `<`:
					return run(node.left, context) < run(node.right, context)

				case `>`:
					return run(node.left, context) > run(node.right, context)

				case `<=`:
					return run(node.left, context) <= run(node.right, context)

				case `>=`:
					return run(node.left, context) >= run(node.right, context)

				case `==`:
					return run(node.left, context) == run(node.right, context)

				case `!=`:
					return run(node.left, context) != run(node.right, context)

				case `===`:
					return run(node.left, context) === run(node.right, context)

				case `!==`:
					return run(node.left, context) !== run(node.right, context)

				case `<<`:
					return run(node.left, context) << run(node.right, context)

				case `>>`:
					return run(node.left, context) >> run(node.right, context)

				case `>>>`:
					return run(node.left, context) >>> run(node.right, context)

				case `&`:
					return run(node.left, context) & run(node.right, context)

				case `|`:
					return run(node.left, context) | run(node.right, context)

				case `^`:
					return run(node.left, context) ^ run(node.right, context)

				case `|>`:
					throw new Error(HERE)
			}
		}

		case `BlockStatement`: {
			const blockScope = scopeContext(context)

			hoist(node.body, blockScope)

			let finalValue

			for (const childNode of node.body) {
				finalValue = run(childNode, blockScope)

				if (blockScope.signal) {
					context.signal = blockScope.signal

					return finalValue
				}
			}

			return finalValue
		}

		case `UpdateExpression`: {
			if (node.argument.type == `Identifier`) {
				let value = run(node.argument, context)

				switch (node.operator) {
					case `++`: {
						const returnValue = node.prefix ? ++value : value++

						setVariable(node.argument.name, value, context)

						return returnValue
					}

					case `--`: {
						const returnValue = node.prefix ? --value : value--

						setVariable(node.argument.name, value, context)

						return returnValue
					}
				}
			}

			assert(node.argument.type == `MemberExpression`, () => `node.argument.type was "${node.argument.type}"`)
			assert(node.argument.property)

			const object = run(node.argument.object, context)
			let key

			if (node.argument.computed) {
				assert(node.argument.property.type == `Identifier`, HERE)
				key = node.argument.property.name
			} else
				key = run(node.argument.property, context)

			if (node.operator == `++`) {
				if (node.prefix)
					return ++object[key]

				return object[key]++
			}

			if (node.prefix)
				return --object[key]

			return object[key]--
		}

		case `ReturnStatement`: {
			const value = node.argument
				? run(node.argument, context)
				: undefined

			context.signal = { type: SignalType.Return, value }

			return value
		}

		case `ArrayExpression`: {
			const array = []

			for (const element of node.elements) {
				if (!element)
					array.length++
				else if (element.type == `SpreadElement`)
					array.push(...run(element.argument, context))
				else
					array.push(run(element, context))
			}

			return array
		}

		case `ObjectExpression`: {
			const object: any = {}

			for (const property of node.properties) {
				if (property.type == `SpreadElement`)
					Object.assign(object, run(property.argument, context))
				else if (property.type == `ObjectProperty`) {
					let name: string

					if (property.computed)
						name = run(property.key, context)
					else if (property.key.type == `Identifier`)
						name = property.key.name
					else
						throw new AssertError(`property.key.type was "${property.key.type}"`)

					object[name] = property.value.type == `FunctionExpression` || property.value.type == `ArrowFunctionExpression`
						? createFunction(property.value, context, name)
						: run(property.value, context)
				} else if (property.type == `ObjectMethod`) {
					switch (property.kind) {
						case `get`: {
							if (property.computed) {
								Object.defineProperty(object, run(property.key, context), {
									get: createFunction(property, context),
									configurable: true,
									enumerable: true
								})

								continue
							}

							assert(property.key.type == `Identifier`, `property.key.type was "${property.key.type}"`)

							Object.defineProperty(object, property.key.name, {
								get: createFunction(property, context),
								configurable: true,
								enumerable: true
							})
						} break

						case `set`: {
							if (property.computed) {
								Object.defineProperty(object, run(property.key, context), {
									set: createFunction(property, context),
									configurable: true,
									enumerable: true
								})

								continue
							}

							assert(property.key.type == `Identifier`, `property.key.type was "${property.key.type}"`)

							Object.defineProperty(object, property.key.name, {
								set: createFunction(property, context),
								configurable: true,
								enumerable: true
							})
						} break

						default:
							throw new AssertError(`property.kind was "${property.kind}"`)
					}
				}
			}

			return object
		}

		case `TemplateLiteral`: {
			let string = node.quasis[0]!.value.cooked

			for (let index = 0; index < node.expressions.length; index++) {
				const templateElement = node.quasis[index + 1]!

				assert(templateElement.type == `TemplateElement`, `templateElement.type was "${templateElement.type}"`)
				string += run(node.expressions[index]!, context) + templateElement.value.cooked
			}

			return string
		}

		case `IfStatement`: {
			const value = run(node.test, context)

			if (value)
				return run(node.consequent, context)

			if (node.alternate)
				return run(node.alternate, context)

			return value
		}

		case `LabeledStatement`: {
			assert(node.label.type == `Identifier`, `node.label.type was "${node.label.type}"`)
			context.statementLabel = node.label.name

			const value = run(node.body, context)

			if (context.signal && context.signal.type == SignalType.Break && context.signal.label == node.label.name)
				context.signal = undefined

			return value
		}

		case `BreakStatement`: {
			if (node.label)
				assert(node.label.type == `Identifier`, `node.label.type was "${node.label.type}"`)

			context.signal = { type: SignalType.Break, label: node.label?.name }

			return
		}

		case `DoWhileStatement`: {
			const forContext = scopeContext(context)
			let finalValue

			do {
				finalValue = run(node.body, forContext)

				if (context.signal?.type == SignalType.Break) {
					if (!context.signal.label)
						context.signal = undefined

					return finalValue
				}
			} while (run(node.test, context))

			return finalValue
		}

		case `ContinueStatement`: {
			if (node.label)
				assert(node.label.type == `Identifier`, `node.label.type was "${node.label.type}"`)

			context.signal = { type: SignalType.Continue, label: node.label?.name }

			return
		}

		case `NewExpression`: {
			const constructor = run(node.callee, context)

			const args = []

			for (const argument of node.arguments) {
				if (argument.type == `SpreadElement`)
					args.push(...run(argument.argument, context))
				else
					args.push(run(argument, context))
			}

			if (typeof constructor == `function`)
				return new constructor(...args)

			throw new TypeError(`not a function`)
		}

		case `ThrowStatement`:
			throw run(node.argument, context)

		case `UnaryExpression`: {
			assert(node.prefix, `node.prefix was false`)

			switch (node.operator) {
				case `delete`: {
					if (node.argument.type != `MemberExpression`)
						return true

					if (node.argument.computed)
						return delete run(node.argument.object, context)[run(node.argument.property, context)]

					assert(node.argument.property.type == `Identifier`, `node.argument.property.type was "${node.argument.property.type}"`)

					return delete run(node.argument.object, context)[node.argument.property.name]
				}

				case `void`:
					return void run(node.argument, context)

				case `typeof`:
					return typeof run(node.argument, context)

				case `+`: {
					// eslint-disable-next-line no-implicit-coercion
					return +run(node.argument, context)
				}

				case `-`:
					return -run(node.argument, context)

				case `~`:
					return ~run(node.argument, context)

				case `!`:
					return !run(node.argument, context)

				case `throw`:
					throw run(node.argument, context)
			}
		}

		case `ThisExpression`: {
			if (context.this === null)
				throw new TypeError(`must call super first`)

			return context.this
		}

		case `LogicalExpression`: {
			switch (node.operator) {
				case `&&`:
					return run(node.left, context) && run(node.right, context)

				case `||`:
					return run(node.left, context) || run(node.right, context)

				case `??`:
					return run(node.left, context) ?? run(node.right, context)
			}
		}

		case `ConditionalExpression`: {
			if (run(node.test, context))
				return run(node.consequent, context)

			return run(node.alternate, context)
		}

		case `TryStatement`: {
			try {
				return run(node.block, context)
			} catch (error) {
				if (!node.handler)
					return

				assert(node.handler.type == `CatchClause`, `node.handler.type was "${node.handler.type}"`)

				if (!node.handler.param)
					return run(node.handler.body, context)

				assert(node.handler.param.type == `Identifier`, `node.handler.param.type was "${node.handler.param.type}"`)

				const catchScope = scopeContext(context)

				catchScope.variables[node.handler.param.name] = error

				return run(node.handler.body, catchScope)
			} finally {
				if (node.finalizer) {
					// eslint-disable-next-line no-unsafe-finally
					return run(node.finalizer, context)
				}
			}
		}

		case `ClassDeclaration`: {
			assert(node.id.type == `Identifier`, `node.id.type was "${node.id.type}"`)
			assert(node.body.type == `ClassBody`, `node.body.type was "${node.body.type}"`)

			const propertyDefinitions = new Map<string, Node>()
			let constructorNode: Node | undefined

			const { superClass, id, body } = node

			const constructor = ({
				[id.name]: class extends (superClass ? run(superClass, context) : Object) {
					constructor(...args: any[]) {
						if (!constructorNode) {
							// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
							const this_: any = super(...args)

							for (const [ name, value ] of propertyDefinitions)
								this_[name] = run(value, context)

							return
						}

						assert(constructorNode.type == `ClassMethod`, `${HERE} constructorNode.type was "${constructorNode.type}"`)
						assert(constructorNode.body.type == `BlockStatement`)

						const constructorScope = scopeContext(context)

						constructorScope.this = undefined

						constructorScope.callSuper = (...args: any[]) => {
							// @ts-expect-error -- not supposed to use `super()` here
							// eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
							constructorScope.this = super(...args)

							for (const [ name, value ] of propertyDefinitions)
								constructorScope.this[name] = run(value, context)

							return constructorScope.this
						}

						if (superClass)
							constructorScope.getSuperProperty = name => super[name]
						else
							constructorScope.callSuper()

						for (let index = 0; index < constructorNode.params.length; index++) {
							const childNode = constructorNode.params[index]!

							if (childNode.type == `Identifier`)
								constructorScope.variables[childNode.name] = args[index]
							else if (childNode.type == `AssignmentPattern`) {
								assert(childNode.left.type == `Identifier`, `childNode.left.type was ${childNode.left.type}`)

								constructorScope.variables[childNode.left.name] =
									args[index] === undefined ? run(childNode.right, context) : args[index]
							} else
								throw new AssertError(`childNode.type was "${childNode.type}"`)
						}

						run(constructorNode.body, constructorScope)

						if (context.signal && context.signal.type == SignalType.Return) {
							const { value } = context.signal

							context.signal = undefined

							return value
						}
					}

					getGetSuperProperty() {
						return (name: string) => super[name]
					}
				}
			})[id.name]!

			const constructorContext: Context = {
				...context,
				getSuperProperty: constructor.prototype.getGetSuperProperty()
			}

			delete (constructor.prototype as any).getGetSuperProperty

			for (const definition of body.body) {
				if (definition.type == `ClassProperty`) {
					if (definition.static) {
						if (definition.computed)
							constructor[run(definition.key, context)] = definition.value ? run(definition.value, context) : undefined
						else {
							assert(definition.key.type == `Identifier`, `definition.key.type was "${definition.key.type}"`)
							constructor[definition.key.name] = definition.value ? run(definition.value, context) : undefined
						}
					} else if (definition.computed)
						propertyDefinitions.set(run(definition.key, context), definition.value || babel.identifier(`undefined`))
					else {
						assert(definition.key.type == `Identifier`, `definition.key.type was "${definition.key.type}"`)
						propertyDefinitions.set(definition.key.name, definition.value || babel.identifier(`undefined`))
					}
				} else if (definition.type == `ClassMethod`) {
					if (definition.kind == `constructor`)
						constructorNode = definition
					else if (definition.kind == `method`) {
						if (definition.static) {
							if (definition.computed) {
								const name: any = run(definition.key, context)

								constructor[name] = createFunction(definition, constructorContext, name)
							} else {
								assert(definition.key.type == `Identifier`, `definition.key.type was "${definition.key.type}"`)
								constructor[definition.key.name] = createFunction(definition, constructorContext, definition.key.name)
							}
						} else if (definition.computed) {
							const name: any = run(definition.key, context)

							constructor.prototype[name] = createFunction(definition, constructorContext, name)
						} else {
							assert(definition.key.type == `Identifier`, `definition.key.type was "${definition.key.type}"`)
							constructor.prototype[definition.key.name] = createFunction(definition, constructorContext, definition.key.name)
						}
					} else
						throw new AssertError(`definition.kind was "${definition.kind}"`)
				} else
					throw new AssertError(`definition.type was "${definition.type}"`)
			}

			context.variables[id.name] = constructor

			return
		}

		case `SequenceExpression`: {
			let finalValue

			for (const expression of node.expressions)
				finalValue = run(expression, context)

			return finalValue
		}

		case `BigIntLiteral`:
			return BigInt(node.value)

		case `BooleanLiteral`:
		case `NumericLiteral`:
		case `StringLiteral`:
			return node.value

		case `NullLiteral`: {
			// eslint-disable-next-line unicorn/no-null
			return null
		}

		case `File`:
			return run(node.program, context)

		default: {
			console.error(node)

			throw new AssertError(`unknown node type "${node.type}"`)
		}
	}
}

function scopeContext({ variables, constants, this: this_, callSuper, getSuperProperty }: Context): Context {
	return {
		variables: Object.create(variables),
		constants: Object.create(constants),
		statementLabel: undefined,
		this: this_,
		signal: undefined,
		callSuper,
		getSuperProperty
	}
}

function getVariable(name: string, { variables, constants }: Context) {
	if (name in constants)
		return constants[name]

	if (name in variables)
		return variables[name]

	throw new ReferenceError(`${HERE} ${name} is not defined`)
}

function setVariable(name: string, value: any, { variables, constants }: Context) {
	if (name in constants)
		throw new TypeError(`assignment to constant`)

	for (let scope = variables; scope; scope = Object.getPrototypeOf(scope)) {
		if (Object.hasOwn(scope, name)) {
			scope[name] = value

			return value
		}
	}

	throw new ReferenceError(`assignment to undeclared variable ${name}`)
}

function hoist(nodes: Node[], context: Context) {
	for (const childNode of nodes) {
		if (childNode.type == `VariableDeclaration` && childNode.kind == `var`) {
			for (const declaration of childNode.declarations) {
				assert(declaration.type == `VariableDeclarator`, `declaration.type wasn't "VariableDeclarator"`)
				assert(declaration.id.type == `Identifier`, `declaration.id.type wasn't "Identifier"`)
				context.variables[declaration.id.name] = undefined
			}
		} else if (childNode.type == `ForStatement` && childNode.init && childNode.init.type == `VariableDeclaration` && childNode.init.kind == `var`) {
			for (const declaration of childNode.init.declarations) {
				assert(declaration.type == `VariableDeclarator`, `declaration.type wasn't "VariableDeclarator"`)
				assert(declaration.id.type == `Identifier`, `declaration.id.type wasn't "Identifier"`)
				context.variables[declaration.id.name] = undefined
			}
		} else if (childNode.type == `FunctionDeclaration`) {
			assert(childNode.id?.type == `Identifier`, `childNode.id.type wasn't "Identifier"`)
			assert(childNode.body.type == `BlockStatement`, `childNode.body.type wasn't "BlockStatement"`)

			const functionDeclaration = childNode
			const { id } = childNode

			context.variables[id.name] = createFunction(functionDeclaration, context, id.name)
		}
	}
}

export function createFunction(node: babel.Function, context: Context, name = ``) {
	if (`id` in node && node.id)
		name = node.id.name

	if (node.async) {
		return {
			[name]: async function(...args: any[]) {
				const functionContext = scopeContext(context)

				// eslint-disable-next-line prefer-rest-params
				functionContext.constants.arguments = arguments

				if (node.type != `ArrowFunctionExpression`)
					functionContext.this = this

				for (let index = 0; index < node.params.length; index++) {
					const childNode = node.params[index]!

					if (childNode.type == `Identifier`)
						functionContext.variables[childNode.name] = args[index]
					else if (childNode.type == `AssignmentPattern`) {
						assert(childNode.left.type == `Identifier`, `childNode.left.type was ${childNode.left.type}`)

						functionContext.variables[childNode.left.name] =
							args[index] === undefined ? run(childNode.right, context) : args[index]
					} else
						throw new AssertError(`childNode.type was "${childNode.type}"`)
				}

				if (node.body.type == `BlockStatement`) {
					run(node.body, functionContext)

					if (functionContext.signal && functionContext.signal.type == SignalType.Return) {
						const { value } = functionContext.signal

						functionContext.signal = undefined

						return value
					}

					return
				}

				return run(node.body, functionContext)
			}
		}[name]
	}

	return {
		[name]: function(...args: any[]) {
			const functionContext = scopeContext(context)

			// eslint-disable-next-line prefer-rest-params
			functionContext.constants.arguments = arguments

			if (node.type != `ArrowFunctionExpression`)
				functionContext.this = this

			for (let index = 0; index < node.params.length; index++) {
				const childNode = node.params[index]!

				if (childNode.type == `Identifier`)
					functionContext.variables[childNode.name] = args[index]
				else if (childNode.type == `AssignmentPattern`) {
					assert(childNode.left.type == `Identifier`, `childNode.left.type was ${childNode.left.type}`)

					functionContext.variables[childNode.left.name] =
						args[index] === undefined ? run(childNode.right, context) : args[index]
				} else
					throw new AssertError(`childNode.type was "${childNode.type}"`)
			}

			if (node.body.type == `BlockStatement`) {
				run(node.body, functionContext)

				if (functionContext.signal && functionContext.signal.type == SignalType.Return) {
					const { value } = functionContext.signal

					functionContext.signal = undefined

					return value
				}

				return
			}

			return run(node.body, functionContext)
		}
	}[name]
}
