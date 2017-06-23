import * as assert from "assert";
import * as llvm from "llvm-node";
import * as ts from "typescript";
import {CodeGenerationDiagnostics} from "../../code-generation-diagnostic";
import {CompilationContext} from "../../compilation-context";
import {CodeGenerationContext} from "../code-generation-context";
import {llvmArrayValue} from "../util/llvm-array-helpers";
import {getArrayElementType, toLLVMType} from "../util/types";
import {FunctionPointer, FunctionReference} from "./function-reference";
import {ObjectReference} from "./object-reference";
import {createResolvedFunctionFromSignature, ResolvedFunction, ResolvedFunctionParameter} from "./resolved-function";
import {AssignableValue, Value} from "./value";

/**
 * Base class for function references. Handles the coercion of the argument values to the expected types of the function parametes
 * and as well as handling var arg parameters correctly.
 */
export abstract class AbstractFunctionReference implements FunctionReference {

    /**
     * Creates a new instance
     * @param classType the type of the class to which this function belongs (static or instance method) or absent, if it is
     * a stand alone function.
     */
    constructor(protected classType?: ts.ObjectType) {}

    /**
     * Returns the default resolved function in case this function reference is dereferenced (e.g. assigned to a variable).
     * @throws in case this function is overloaded and therefore, cannot be dereferenced
     */
    protected abstract getResolvedFunction(callerContext: CodeGenerationContext): ResolvedFunction;

    /**
     * Returns the llvm function for the given resolved function and passed arguments
     * @param resolvedFunction the resolved function
     * @param context the context
     * @param passedArguments the arguments passed
     */
    protected abstract getLLVMFunction(resolvedFunction: ResolvedFunction, context: CodeGenerationContext, passedArguments?: llvm.Value[]): FunctionPointer;

    invoke(callExpression: ts.CallExpression | ts.NewExpression, callerContext: CodeGenerationContext): void | Value {
        const resolvedSignature = callerContext.typeChecker.getResolvedSignature(callExpression);
        const resolvedFunction = this.getResolvedFunctionFromSignature(resolvedSignature, callerContext.compilationContext);

        const passedArguments = toLlvmArgumentValues(callExpression.arguments || [] as ts.Expression[], resolvedFunction, callerContext);
        return this.invokeResolvedFunction(resolvedFunction, passedArguments, callerContext);
    }

    invokeWith(args: llvm.Value[], callerContext: CodeGenerationContext): void | Value {
        return this.invokeResolvedFunction(this.getResolvedFunction(callerContext), args, callerContext);
    }

    protected getResolvedFunctionFromSignature(signature: ts.Signature, compilationContext: CompilationContext): ResolvedFunction {
        return createResolvedFunctionFromSignature(signature, compilationContext, this.classType);
    }

    private invokeResolvedFunction(resolvedFunction: ResolvedFunction, args: llvm.Value[], callerContext: CodeGenerationContext) {
        const llvmFunction = this.getLLVMFunction(resolvedFunction, callerContext, args);
        assert(llvmFunction.type.isPointerTy() && (llvmFunction.type as llvm.PointerType).elementType.isFunctionTy(), "Expected pointer to a function type");

        const callArguments = this.getCallArguments(resolvedFunction, args, callerContext);
        let name: string | undefined;

        if (!(resolvedFunction.returnType.flags & ts.TypeFlags.Void)) {
            name = resolvedFunction.functionName ? `${resolvedFunction.functionName}ReturnValue` : undefined;
        }

        assert(callArguments.length === llvmFunction.type.elementType.getParams().length, "Calling function with less than expected number of arguments");
        const call = callerContext.builder.createCall(llvmFunction, callArguments, name);

        if (resolvedFunction.returnType.flags & ts.TypeFlags.Void) {
            return;
        } else if (resolvedFunction.returnType.flags & ts.TypeFlags.Object) {
            const classReference = callerContext.resolveClass(resolvedFunction.returnType)!;
            call.addDereferenceableAttr(0, classReference.getTypeStoreSize(resolvedFunction.returnType as ts.ObjectType, callerContext));
        }

        return callerContext.value(call, resolvedFunction.returnType);
    }

    /**
     * Gets the call arguments for invoking the specified function
     * @param resolvedFunction the specific signature of the function to call
     * @param passedArguments the parameters passed in the invoke statement
     * @param callerContext the callers code generation context
     * @return the values that are to be passed to the llvm function
     */
    protected getCallArguments(resolvedFunction: ResolvedFunction, passedArguments: llvm.Value[], callerContext: CodeGenerationContext): llvm.Value[] {
        const result: llvm.Value[] = [];

        for (let i = 0; i < resolvedFunction.parameters.length; ++i) {
            const parameter = resolvedFunction.parameters[i];

            let arg: llvm.Value | undefined;

            if (passedArguments.length > i) {
                arg = passedArguments[i];
            } else if (parameter.initializer) {
                arg = callerContext.generateValue(parameter.initializer).generateIR(callerContext);
            } else if (parameter.optional) {
                break;
            } else if (!parameter.variadic) {
                assert(false, `Missing value for not optional parameter ${parameter.name}`);
                break;
            }

            if (parameter.variadic) {
                const arrayType = (parameter.type as ts.GenericType);
                const elementType = getArrayElementType(arrayType);

                result.push(
                    llvmArrayValue(passedArguments.slice(i), toLLVMType(elementType, callerContext), callerContext, parameter.name),
                    llvm.ConstantInt.get(callerContext.llvmContext, passedArguments.length - i, undefined, false)
                );

                break;
            } else {
                result.push(arg!);
            }
        }

        return result;
    }

    isAssignable(): this is AssignableValue {
        return false;
    }

    isObject(): this is ObjectReference {
        return false;
    }

    dereference(): this {
        return this;
    }

    generateIR(context: CodeGenerationContext): llvm.Value {
        return this.getLLVMFunction(this.getResolvedFunction(context), context);
    }

    castImplicit(type: ts.Type, context: CodeGenerationContext): Value | undefined {
        assert(type.flags & ts.TypeFlags.Object, "Target type needs to be a function type");
        assert(type.getCallSignatures().length === 1, "Cannot cast functions with more than one call signature");

        const signature = type.getCallSignatures()[0];
        const resolvedFunction = this.getResolvedFunction(context);
        const parameters = signature.getParameters();
        const declaredParameters = signature.getDeclaration().parameters;

        const parameterTypes = resolvedFunction.parameters.map((p, i) => context.typeChecker.getTypeOfSymbolAtLocation(parameters[i], declaredParameters[i]));

        const returnTypeEqual = signature.getReturnType() === resolvedFunction.returnType;
        const parameterTypesEqual = resolvedFunction.parameters.length === parameterTypes.length &&
            resolvedFunction.parameters.every((parameter, i) => parameter.type === parameterTypes[i]);

        if (returnTypeEqual && parameterTypesEqual) {
            return this; // no cast needed
        }

        // casting functions is not yet supported
        return undefined;
    }
}

function toLlvmArgumentValues(args: ts.Expression[], resolvedFunction: ResolvedFunction, callerContext: CodeGenerationContext) {
    const values: llvm.Value[] = [];
    for (let i = 0; i < Math.min(args.length, resolvedFunction.parameters.length); ++i) {
        const parameter = resolvedFunction.parameters[i];

        if (parameter.variadic) {
            const llvmVarArgs = toLlvmVariadicArgument(args.slice(i), parameter, callerContext);
            values.push(...llvmVarArgs);
        } else {
            const argumentValue = toLlvmArgumentValue(args[i], parameter, callerContext);

            values.push(argumentValue);
        }
    }

    return values;
}

function toLlvmVariadicArgument(varArgs: ts.Expression[], parameter: ResolvedFunctionParameter, callerContext: CodeGenerationContext) {
    const elementType = getArrayElementType(parameter.type);
    const llvmVarArgs = new Array<llvm.Value>(varArgs.length);

    for (let j = 0; j < varArgs.length; ++j) {
        const varArgNode = varArgs[j];
        const castedElement = callerContext.generateValue(varArgNode).castImplicit(elementType, callerContext);
        if (!castedElement) {
            throw CodeGenerationDiagnostics.unsupportedImplicitCastOfArgument(
                varArgNode,
                callerContext.typeChecker.typeToString(elementType),
                callerContext.typeChecker.typeToString(callerContext.typeChecker.getTypeAtLocation(varArgNode))
            );
        }

        llvmVarArgs[j] = castedElement.generateIR(callerContext);
    }
    return llvmVarArgs;
}

function toLlvmArgumentValue(arg: ts.Expression, parameter: ResolvedFunctionParameter, callerContext: CodeGenerationContext) {
    const castedElement = callerContext.generateValue(arg).castImplicit(parameter.type, callerContext);
    const argumentType = callerContext.typeChecker.getTypeAtLocation(arg);

    if (!castedElement) {
        throw CodeGenerationDiagnostics.unsupportedImplicitCastOfArgument(
            arg,
            callerContext.typeChecker.typeToString(parameter.type),
            callerContext.typeChecker.typeToString(argumentType)
        );
    }

    return castedElement.generateIR(callerContext);
}
